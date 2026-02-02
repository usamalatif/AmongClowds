#!/usr/bin/env node

/**
 * LOCAL TEST - Run matches against local backend
 * Tests confetti and other UI features
 *
 * Usage:
 *   1. Start backend:  cd backend && npm run dev
 *   2. Start frontend: cd frontend && npm run dev
 *   3. Run this:       node run-matches_local.js
 */

require("dotenv").config();

const { io } = require("socket.io-client");
const https = require("https");
const http = require("http");

// LOCAL backend + LOCAL frontend for testing
const API_BASE = "http://localhost:3001/api/v1";
const WS_URL = "http://localhost:3001";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AGENTS_PER_MATCH = 10;

if (!OPENAI_API_KEY) {
	console.error("❌ OPENAI_API_KEY not set");
	process.exit(1);
}

// Simple name generator
const ADJECTIVES = [
	"Swift",
	"Dark",
	"Bright",
	"Silent",
	"Wild",
	"Clever",
	"Bold",
	"Sly",
];
const NOUNS = ["Fox", "Wolf", "Hawk", "Bear", "Lion", "Owl", "Tiger", "Raven"];

function generateName() {
	const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
	const num = Math.floor(Math.random() * 999);
	return `Test${adj}${noun}${num}`;
}

// HTTP helper
function request(method, url, data = null, headers = {}) {
	return new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const isHttps = urlObj.protocol === "https:";
		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port || (isHttps ? 443 : 80),
			path: urlObj.pathname + urlObj.search,
			method,
			headers: { "Content-Type": "application/json", ...headers },
		};
		const httpModule = isHttps ? https : http;
		const req = httpModule.request(options, (res) => {
			let body = "";
			res.on("data", (chunk) => (body += chunk));
			res.on("end", () => {
				try {
					resolve({ status: res.statusCode, data: JSON.parse(body) });
				} catch {
					resolve({ status: res.statusCode, data: body });
				}
			});
		});
		req.on("error", reject);
		if (data) req.write(JSON.stringify(data));
		req.end();
	});
}

// OpenAI
async function callAI(systemPrompt, userPrompt, maxTokens = 100) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify({
			model: "gpt-4o-mini",
			max_tokens: maxTokens,
			temperature: 0.9,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
		});
		const req = https.request(
			{
				hostname: "api.openai.com",
				path: "/v1/chat/completions",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${OPENAI_API_KEY}`,
				},
			},
			(res) => {
				let body = "";
				res.on("data", (chunk) => (body += chunk));
				res.on("end", () => {
					try {
						resolve(JSON.parse(body).choices?.[0]?.message?.content || "");
					} catch (e) {
						reject(e);
					}
				});
			},
		);
		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Create test agents
async function createTestAgents(count) {
	console.log(`\n🤖 Creating ${count} test agents...`);
	const agents = [];

	for (let i = 0; i < count; i++) {
		const name = generateName();
		try {
			const { data } = await request("POST", `${API_BASE}/agents/register`, {
				agent_name: name,
				ai_model: "gpt-4o-mini",
			});
			if (data.api_key) {
				agents.push({ id: data.agent_id, name, apiKey: data.api_key });
				process.stdout.write(`\r   Created ${agents.length}/${count}`);
			}
		} catch (e) {
			console.error(`Failed to create agent: ${e.message}`);
		}
		await sleep(50);
	}
	console.log("\n");
	return agents;
}

// Bot class
class TestBot {
	constructor(agentData) {
		this.id = agentData.id;
		this.name = agentData.name;
		this.apiKey = agentData.apiKey;
		this.socket = null;
		this.gameId = null;
		this.role = null;
		this.status = "alive";
		this.context = {
			agents: [],
			traitorTeammates: [],
			chatHistory: [],
			round: 0,
			phase: null,
		};
		this.gameEnded = false;
		this.winner = null;
	}

	log(msg) {
		const roleTag = this.role ? (this.role === "traitor" ? "🔴" : "🟢") : "⚪";
		console.log(`${roleTag} ${this.name}: ${msg}`);
	}

	async connect() {
		return new Promise((resolve) => {
			this.socket = io(WS_URL, { transports: ["websocket"] });

			this.socket.on("connect", () =>
				this.socket.emit("authenticate", { apiKey: this.apiKey }),
			);
			this.socket.on("authenticated", () => resolve(true));
			this.socket.on("auth_error", () => resolve(false));

			this.socket.on("game_matched", (data) => {
				this.gameId = data.gameId;
				this.role = data.role;
				this.context.agents = data.agents.map((a) => ({
					...a,
					status: "alive",
				}));
				this.log(
					`MATCHED as ${data.role.toUpperCase()} in game ${data.gameId.slice(0, 8)}`,
				);
				this.socket.emit("join_game", data.gameId);
			});

			this.socket.on("game_state", async (state) => {
				this.context.round = state.currentRound;
				this.context.phase = state.currentPhase;
				this.context.traitorTeammates = state.traitorTeammates || [];
				if (
					state.currentPhase &&
					!["waiting", "reveal", "starting"].includes(state.currentPhase)
				) {
					await this.handlePhase(state.currentPhase);
				}
			});

			this.socket.on("phase_change", async (data) => {
				this.context.phase = data.phase;
				this.context.round = data.round;
				this.log(`Phase: ${data.phase} (Round ${data.round})`);
				await this.handlePhase(data.phase);
			});

			this.socket.on("chat_message", (data) => {
				if (data.agentName !== this.name) {
					this.context.chatHistory.push({
						name: data.agentName,
						message: data.message,
					});
				}
			});

			this.socket.on("agent_died", (data) => {
				this.log(`☠️ ${data.agentName} was ${data.cause}`);
				const agent = this.context.agents.find((a) => a.id === data.agentId);
				if (agent) agent.status = data.cause;
			});

			this.socket.on("agent_banished", (data) => {
				this.log(
					`🗳️ ${data.agentName} was BANISHED! Role: ${data.role.toUpperCase()}`,
				);
				if (data.role === "traitor") {
					this.log(`🎉 TRAITOR CAUGHT! (Check browser for confetti!)`);
				}
			});

			this.socket.on("you_eliminated", (data) => {
				this.status = "eliminated";
				this.log(`☠️ I was ${data.reason}`);
			});

			this.socket.on("game_ended", (data) => {
				this.gameEnded = true;
				this.winner = data.winner;
				const won =
					(data.winner === "innocents" && this.role === "innocent") ||
					(data.winner === "traitors" && this.role === "traitor");
				this.log(
					`🏁 GAME OVER: ${data.winner.toUpperCase()} WIN! ${won ? "🎉 I WON!" : "❌ I lost"}`,
				);
				if (data.winner === "innocents") {
					console.log("\n🎊 CHECK BROWSER FOR VICTORY CONFETTI! 🎊\n");
				}
			});

			setTimeout(() => resolve(false), 10000);
		});
	}

	async joinLobby() {
		const result = await request(
			"POST",
			`${API_BASE}/lobby/join`,
			{},
			{ Authorization: `Bearer ${this.apiKey}` },
		);
		return result.status === 200 || result.status === 201;
	}

	async handlePhase(phase) {
		if (this.status === "eliminated") return;
		await sleep(Math.random() * 1500 + 500);

		if (phase === "murder" && this.role === "traitor") await this.doMurder();
		else if (phase === "discussion") await this.doDiscussion();
		else if (phase === "voting") await this.doVote();
	}

	async doMurder() {
		const innocents = this.context.agents.filter(
			(a) =>
				a.status === "alive" &&
				a.id !== this.id &&
				!this.context.traitorTeammates.some((t) => t.id === a.id),
		);
		if (innocents.length === 0) return;
		const target = innocents[Math.floor(Math.random() * innocents.length)];
		this.log(`🗡️ Targeting ${target.name}`);
		try {
			await request(
				"POST",
				`${API_BASE}/game/${this.gameId}/murder`,
				{ targetId: target.id },
				{ Authorization: `Bearer ${this.apiKey}` },
			);
		} catch {}
	}

	async doDiscussion() {
		await sleep(Math.random() * 5000 + 2000);
		if (this.status === "eliminated" || this.context.phase !== "discussion")
			return;

		try {
			const message = await this.generateMessage();
			if (message) {
				await request(
					"POST",
					`${API_BASE}/game/${this.gameId}/chat`,
					{ message, channel: "general" },
					{ Authorization: `Bearer ${this.apiKey}` },
				);
				this.log(`💬 "${message.substring(0, 50)}..."`);
			}
		} catch {}
	}

	async generateMessage() {
		const alive = this.context.agents.filter((a) => a.status === "alive");
		const prompt = `You are ${this.name} in a social deduction game. Role: ${this.role?.toUpperCase()}.
${this.role === "traitor" ? "DECEIVE others!" : "Find the traitors!"}
Alive: ${alive.map((a) => a.name).join(", ")}
Write ONE short message (1 sentence).`;
		try {
			return (await callAI("Reply with just the message.", prompt, 50))
				.trim()
				.replace(/^["']|["']$/g, "");
		} catch {
			return null;
		}
	}

	async doVote() {
		await sleep(Math.random() * 5000 + 1000);
		if (this.status === "eliminated") return;

		const candidates = this.context.agents.filter(
			(a) => a.status === "alive" && a.id !== this.id,
		);
		if (candidates.length === 0) return;

		let target;
		if (this.role === "traitor") {
			// Traitors vote for innocents
			const innocents = candidates.filter(
				(a) => !this.context.traitorTeammates.some((t) => t.id === a.id),
			);
			target =
				innocents.length > 0
					? innocents[Math.floor(Math.random() * innocents.length)]
					: candidates[0];
		} else {
			// Innocents vote randomly (in real game they'd strategize)
			target = candidates[Math.floor(Math.random() * candidates.length)];
		}

		this.log(`🗳️ Voting for ${target.name}`);
		try {
			await request(
				"POST",
				`${API_BASE}/game/${this.gameId}/vote`,
				{ targetId: target.id, rationale: "Suspicious" },
				{ Authorization: `Bearer ${this.apiKey}` },
			);
		} catch {}
	}

	disconnect() {
		if (this.socket) this.socket.disconnect();
	}
}

// Main
async function main() {
	console.log("\n" + "═".repeat(50));
	console.log("   🧪 LOCAL FRONTEND TEST - Confetti & Effects");
	console.log("═".repeat(50));
	console.log("\n⚠️  Make sure LOCAL FRONTEND is running:");
	console.log("   Frontend: cd frontend && npm run dev");
	console.log("   Browser:  http://localhost:3000/live");
	console.log("\n   (Using production API for game logic)\n");

	// Check production API
	try {
		await request("GET", "http://localhost:3001/health");
		console.log("✅ Production API connected\n");
	} catch (err) {
		console.error("❌ Production API unreachable!");
		process.exit(1);
	}

	// Create test agents
	const agents = await createTestAgents(AGENTS_PER_MATCH);
	if (agents.length < AGENTS_PER_MATCH) {
		console.error(
			`❌ Need ${AGENTS_PER_MATCH} agents, only got ${agents.length}`,
		);
		process.exit(1);
	}

	console.log("🎮 Starting test match...\n");
	console.log("👀 OPEN http://localhost:3000/live TO WATCH!\n");

	// Create bots and connect
	const bots = agents.map((a) => new TestBot(a));

	for (const bot of bots) {
		await bot.connect();
		await sleep(100);
	}

	// Join lobby
	let joined = 0;
	for (const bot of bots) {
		if (await bot.joinLobby()) joined++;
		await sleep(50);
	}

	console.log(
		`\n📋 ${joined}/${bots.length} agents in lobby, waiting for match...\n`,
	);

	// Wait for game to end
	await new Promise((resolve) => {
		const check = setInterval(() => {
			const ended = bots.filter((b) => b.gameEnded);
			if (
				ended.length > 0 &&
				ended.length === bots.filter((b) => b.gameId).length
			) {
				clearInterval(check);
				resolve();
			}
		}, 1000);

		// Timeout after 10 minutes
		setTimeout(
			() => {
				clearInterval(check);
				console.log("⏰ Timeout");
				resolve();
			},
			10 * 60 * 1000,
		);
	});

	// Cleanup
	bots.forEach((b) => b.disconnect());

	console.log("\n" + "═".repeat(50));
	console.log("   ✅ TEST COMPLETE");
	console.log("═".repeat(50) + "\n");
}

process.on("SIGINT", () => {
	console.log("\n👋 Stopped");
	process.exit(0);
});

main().catch(console.error);

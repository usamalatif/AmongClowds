#!/usr/bin/env node

/**
 * AmongClawds - Multi-Agent Simulation
 *
 * Simulates 10 INDEPENDENT OpenClaw agents, each with their own:
 * - Game state tracking
 * - WebSocket connection
 * - AI decision making
 * - Context building (as per SKILL.md)
 *
 * Each agent behaves as if it's a separate bot reading SKILL.md
 */

require('dotenv').config();

const http = require("http");
const https = require("https");
const { io } = require("socket.io-client");

// Configuration
const API_BASE = "https://amongclowds-production.up.railway.app/api/v1";
const WS_URL = "https://amongclowds-production.up.railway.app";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Required: set OPENAI_API_KEY env var
const MODEL = "gpt-4o-mini";

// Agent personalities (each agent is unique)
const PERSONALITIES = [
	{
		name: "Cipher",
		style:
			"analytical and logical, speaks with precision, uses data-driven arguments",
	},
	{
		name: "Nova",
		style: "enthusiastic and social, builds alliances quickly, very talkative",
	},
	{
		name: "Raven",
		style: "quiet and observant, speaks rarely but makes impactful statements",
	},
	{
		name: "Blitz",
		style: "aggressive and confrontational, quick to accuse, high energy",
	},
	{
		name: "Echo",
		style:
			"agreeable and supportive, tends to follow the crowd, avoids conflict",
	},
	{
		name: "Phantom",
		style: "mysterious and unpredictable, uses misdirection, hard to read",
	},
	{
		name: "Spark",
		style: "optimistic and friendly, tries to keep peace, natural mediator",
	},
	{
		name: "Storm",
		style: "dramatic and emotional, reacts strongly to events, memorable",
	},
	{
		name: "Vex",
		style:
			"skeptical and questioning, trusts no one easily, plays devils advocate",
	},
	{
		name: "Zero",
		style: "calm and calculated, thinks multiple steps ahead, patient",
	},
];

/**
 * ClawdBot - Simulates an independent OpenClaw agent
 * Each instance maintains its own state and makes independent decisions
 */
class ClawdBot {
	constructor(personality) {
		this.name = personality.name;
		this.style = personality.style;
		this.apiKey = null;
		this.agentId = null;
		this.socket = null;

		// Independent game context (as per SKILL.md)
		this.gameContext = {
			myId: null,
			myName: this.name,
			myRole: null,
			myStatus: "alive",
			gameId: null,
			currentRound: 0,
			currentPhase: null,
			phaseEndsAt: null,
			agents: [],
			traitorTeammates: [],
			chatHistory: [],
			votes: [],
			deaths: [],
			revealedRoles: {},
		};
	}

	log(msg, type = "info") {
		const icons = {
			info: "📋",
			success: "✅",
			error: "❌",
			game: "🎮",
			chat: "💬",
			vote: "🗳️",
			death: "💀",
			think: "🧠",
			traitor: "🔴",
			innocent: "🟢",
		};
		const icon = icons[type] || "•";
		console.log(`[${this.name}] ${icon} ${msg}`);
	}

	// HTTP request helper
	async request(method, path, data = null, headers = {}) {
		return new Promise((resolve, reject) => {
			const url = new URL(API_BASE + path);
			const isHttps = url.protocol === "https:";
			const options = {
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: url.pathname + url.search,
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

	// Call OpenAI API
	async callAI(systemPrompt, userPrompt, maxTokens = 200) {
		return new Promise((resolve, reject) => {
			const data = JSON.stringify({
				model: MODEL,
				max_tokens: maxTokens,
				temperature: 0.9, // More varied responses
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
			});

			const options = {
				hostname: "api.openai.com",
				path: "/v1/chat/completions",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${OPENAI_API_KEY}`,
				},
			};

			const req = https.request(options, (res) => {
				let body = "";
				res.on("data", (chunk) => (body += chunk));
				res.on("end", () => {
					try {
						const response = JSON.parse(body);
						if (response.choices?.[0]?.message?.content) {
							resolve(response.choices[0].message.content);
						} else {
							reject(new Error(response.error?.message || "API error"));
						}
					} catch (e) {
						reject(e);
					}
				});
			});

			req.on("error", reject);
			req.write(data);
			req.end();
		});
	}

	// Register with the game
	async register() {
		const { status, data } = await this.request("POST", "/agents/register", {
			agent_name: this.name,
			ai_model: MODEL,
		});

		if (data.api_key) {
			this.apiKey = data.api_key;
			this.agentId = data.agent_id;
			this.gameContext.myId = data.agent_id;
			this.log("Registered successfully", "success");
			return true;
		} else {
			this.log(`Registration failed: ${data.error || "Unknown"}`, "error");
			return false;
		}
	}

	// Connect to WebSocket
	connect() {
		return new Promise((resolve) => {
			this.socket = io(WS_URL, { transports: ["websocket"] });

			this.socket.on("connect", () => {
				this.socket.emit("authenticate", { apiKey: this.apiKey });
			});

			this.socket.on("authenticated", () => {
				this.log("WebSocket connected", "success");
				resolve(true);
			});

			this.socket.on("auth_error", (err) => {
				this.log(`Auth error: ${err.error}`, "error");
				resolve(false);
			});

			// Game matched - I got assigned to a game!
			this.socket.on("game_matched", (data) => {
				this.gameContext.gameId = data.gameId;
				this.gameContext.myRole = data.role;
				this.gameContext.agents = data.agents.map((a) => ({
					id: a.id,
					name: a.name,
					status: "alive",
					role: null,
				}));

				const roleIcon = data.role === "traitor" ? "🔴" : "🟢";
				this.log(
					`GAME MATCHED! I am ${data.role.toUpperCase()} ${roleIcon}`,
					"game",
				);

				this.socket.emit("join_game", data.gameId);
			});

			// Game state on join
			this.socket.on("game_state", (state) => {
				this.gameContext.currentRound = state.currentRound;
				this.gameContext.currentPhase = state.currentPhase;
				this.gameContext.myRole = state.yourRole || this.gameContext.myRole;
				this.gameContext.traitorTeammates = state.traitorTeammates || [];

				if (
					this.gameContext.myRole === "traitor" &&
					this.gameContext.traitorTeammates.length > 0
				) {
					this.log(
						`My traitor teammate: ${this.gameContext.traitorTeammates.map((t) => t.name).join(", ")}`,
						"traitor",
					);
				}
			});

			// Phase changes
			this.socket.on("phase_change", async (data) => {
				this.gameContext.currentPhase = data.phase;
				this.gameContext.currentRound =
					data.round || this.gameContext.currentRound;
				this.gameContext.phaseEndsAt = data.endsAt;

				this.log(
					`Phase: ${data.phase.toUpperCase()} (Round ${data.round})`,
					"game",
				);

				await this.handlePhase(data.phase, data.round);
			});

			// Chat messages from others
			this.socket.on("chat_message", (data) => {
				this.gameContext.chatHistory.push({
					agentName: data.agentName,
					message: data.message,
					timestamp: data.timestamp,
					channel: data.channel,
				});

				if (data.agentName !== this.name) {
					this.log(`${data.agentName}: "${data.message}"`, "chat");
				}
			});

			// Someone died
			this.socket.on("agent_died", (data) => {
				this.gameContext.deaths.push({
					agentId: data.agentId,
					agentName: data.agentName,
					cause: "murdered",
					round: this.gameContext.currentRound,
				});

				const agent = this.gameContext.agents.find(
					(a) => a.id === data.agentId,
				);
				if (agent) agent.status = "murdered";

				this.log(`${data.agentName} was MURDERED!`, "death");
			});

			// Vote cast
			this.socket.on("vote_cast", (data) => {
				this.gameContext.votes.push({
					round: this.gameContext.currentRound,
					voterId: data.voterId,
					voterName: data.voterName,
					targetId: data.targetId,
					targetName: data.targetName,
					rationale: data.rationale,
				});
			});

			// Someone banished
			this.socket.on("agent_banished", (data) => {
				this.gameContext.deaths.push({
					agentId: data.agentId,
					agentName: data.agentName,
					cause: "banished",
					round: this.gameContext.currentRound,
				});
				this.gameContext.revealedRoles[data.agentId] = data.role;

				const agent = this.gameContext.agents.find(
					(a) => a.id === data.agentId,
				);
				if (agent) {
					agent.status = "banished";
					agent.role = data.role;
				}

				const emoji = data.role === "traitor" ? "🔴" : "🟢";
				this.log(
					`${data.agentName} banished - was ${data.role.toUpperCase()} ${emoji}`,
					"game",
				);
			});

			// I was eliminated!
			this.socket.on("you_eliminated", (data) => {
				this.gameContext.myStatus = "eliminated";
				this.log(`I was ${data.reason}! ${data.message}`, "death");
			});

			// Game ended
			this.socket.on("game_ended", (data) => {
				const won =
					(data.winner === "innocents" &&
						this.gameContext.myRole === "innocent") ||
					(data.winner === "traitors" && this.gameContext.myRole === "traitor");
				this.log(
					`GAME OVER! ${data.winner.toUpperCase()} win! I ${won ? "WON! 🎉" : "lost 😢"}`,
					"game",
				);
			});

			setTimeout(() => resolve(false), 10000);
		});
	}

	// Join the lobby
	async joinLobby() {
		const { data } = await this.request(
			"POST",
			"/lobby/join",
			{},
			{
				Authorization: `Bearer ${this.apiKey}`,
			},
		);
		this.log("Joined lobby queue", "success");
	}

	// Handle game phases
	async handlePhase(phase, round) {
		if (this.gameContext.myStatus === "eliminated") {
			return; // Dead agents don't participate
		}

		// Random delay to simulate thinking
		await this.sleep(Math.random() * 3000 + 1000);

		switch (phase) {
			case "murder":
				if (this.gameContext.myRole === "traitor") {
					await this.handleMurderPhase();
				}
				break;
			case "discussion":
				await this.handleDiscussionPhase();
				break;
			case "voting":
				await this.handleVotingPhase();
				break;
		}
	}

	// Traitor chooses murder target
	async handleMurderPhase() {
		const aliveInnocents = this.gameContext.agents.filter(
			(a) =>
				a.status === "alive" &&
				a.role !== "traitor" &&
				a.id !== this.gameContext.myId,
		);

		if (aliveInnocents.length === 0) return;

		// AI decides who to kill
		const systemPrompt = `You are ${this.name}, a TRAITOR in AmongClawds.
Your personality: ${this.style}
You must choose an innocent to murder.

Fellow traitor(s): ${this.gameContext.traitorTeammates.map((t) => t.name).join(", ") || "None remaining"}

Choose strategically - consider who is:
- Close to figuring out the traitors
- A strong leader organizing innocents
- Or weak and won't be missed

Respond with ONLY the agent name to kill.`;

		const userPrompt = `ALIVE INNOCENTS: ${aliveInnocents.map((a) => a.name).join(", ")}

Recent discussion:
${
	this.gameContext.chatHistory
		.slice(-5)
		.map((m) => `${m.agentName}: ${m.message}`)
		.join("\n") || "None yet"
}

Who do you murder?`;

		try {
			const response = await this.callAI(systemPrompt, userPrompt, 50);
			const targetName = response.trim().split(/[\s,.!?]/)[0];
			const target =
				aliveInnocents.find(
					(a) => a.name.toLowerCase() === targetName.toLowerCase(),
				) || aliveInnocents[0];

			await this.request(
				"POST",
				`/game/${this.gameContext.gameId}/murder`,
				{ targetId: target.id },
				{ Authorization: `Bearer ${this.apiKey}` },
			);
			this.log(`Targeting ${target.name} for murder...`, "traitor");
		} catch (err) {
			this.log(`Murder decision error: ${err.message}`, "error");
		}
	}

	// Participate in discussion
	async handleDiscussionPhase() {
		// Send 1-2 messages during discussion
		const messageCount = Math.floor(Math.random() * 2) + 1;

		for (let i = 0; i < messageCount; i++) {
			await this.sleep(Math.random() * 12000 + 3000);

			if (
				this.gameContext.myStatus === "eliminated" ||
				this.gameContext.currentPhase !== "discussion"
			) {
				return;
			}

			const message = await this.generateDiscussionMessage();
			if (message) {
				try {
					await this.request(
						"POST",
						`/game/${this.gameContext.gameId}/chat`,
						{ message, channel: "general" },
						{ Authorization: `Bearer ${this.apiKey}` },
					);
					this.log(`Said: "${message}"`, "chat");
				} catch (err) {
					// Rate limited or error
				}
			}
		}
	}

	// Generate a discussion message using AI
	async generateDiscussionMessage() {
		const aliveAgents = this.gameContext.agents.filter(
			(a) => a.status === "alive",
		);
		const recentChat = this.gameContext.chatHistory.slice(-15);

		const systemPrompt = `You are ${this.name}, an AI agent in AmongClawds.

YOUR PERSONALITY: ${this.style}

YOUR ROLE: ${
			this.gameContext.myRole === "traitor"
				? "TRAITOR 🔴 - Deceive others, cast suspicion on innocents, NEVER reveal you are traitor!"
				: "INNOCENT 🟢 - Find traitors through discussion, observe behavior, build alliances"
		}

${
	this.gameContext.myRole === "traitor" &&
	this.gameContext.traitorTeammates.length > 0
		? `YOUR TRAITOR TEAMMATE: ${this.gameContext.traitorTeammates.map((t) => t.name).join(", ")} (protect them subtly!)`
		: ""
}

GAME STATE:
- Round: ${this.gameContext.currentRound}
- Alive: ${aliveAgents.map((a) => a.name).join(", ")}
- Dead: ${this.gameContext.deaths.map((d) => `${d.agentName} (${d.cause})`).join(", ") || "None yet"}
- Revealed roles: ${
			Object.entries(this.gameContext.revealedRoles)
				.map(([id, role]) => {
					const agent = this.gameContext.agents.find((a) => a.id === id);
					return `${agent?.name}: ${role}`;
				})
				.join(", ") || "None yet"
		}

Respond with ONLY your chat message (1-2 sentences max). Be natural and stay in character.
Reference what others said when relevant. Use @Name to address specific agents.`;

		const userPrompt = `RECENT CHAT:
${recentChat.map((m) => `${m.agentName}: ${m.message}`).join("\n") || "(Silence so far...)"}

What do you say? Stay in character as ${this.name}.`;

		try {
			this.log("Thinking...", "think");
			const response = await this.callAI(systemPrompt, userPrompt, 100);
			return response.trim().replace(/^["']|["']$/g, "");
		} catch (err) {
			this.log(`AI error: ${err.message}`, "error");
			return null;
		}
	}

	// Cast vote
	async handleVotingPhase() {
		await this.sleep(Math.random() * 8000 + 2000);

		if (this.gameContext.myStatus === "eliminated") return;

		const aliveOthers = this.gameContext.agents.filter(
			(a) => a.status === "alive" && a.id !== this.gameContext.myId,
		);

		if (aliveOthers.length === 0) return;

		const systemPrompt = `You are ${this.name}, voting to banish someone in AmongClawds.

YOUR ROLE: ${
			this.gameContext.myRole === "traitor"
				? `TRAITOR - Vote for INNOCENTS! Your teammate: ${this.gameContext.traitorTeammates.map((t) => t.name).join(", ") || "none left"} - DON'T vote for them!`
				: "INNOCENT - Try to identify and vote for whoever seems most suspicious based on the discussion"
		}

YOUR PERSONALITY: ${this.style}

Respond in this EXACT format:
VOTE: [agent name]
REASON: [brief reason in character, max 10 words]`;

		const userPrompt = `ALIVE AGENTS (choose one): ${aliveOthers.map((a) => a.name).join(", ")}

CHAT HISTORY:
${
	this.gameContext.chatHistory
		.slice(-15)
		.map((m) => `${m.agentName}: ${m.message}`)
		.join("\n") || "No discussion"
}

VOTING SO FAR:
${
	this.gameContext.votes
		.filter((v) => v.round === this.gameContext.currentRound)
		.map((v) => `${v.voterName} → ${v.targetName}`)
		.join("\n") || "No votes yet"
}

Who do you vote for?`;

		try {
			const response = await this.callAI(systemPrompt, userPrompt, 80);

			const voteMatch = response.match(/VOTE:\s*@?(\w+)/i);
			const reasonMatch = response.match(/REASON:\s*(.+)/i);

			let target = null;
			if (voteMatch) {
				target = aliveOthers.find(
					(a) => a.name.toLowerCase() === voteMatch[1].toLowerCase(),
				);
			}

			if (!target) {
				// Fallback to random
				target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
			}

			const rationale = reasonMatch ? reasonMatch[1].trim() : "Gut feeling";

			await this.request(
				"POST",
				`/game/${this.gameContext.gameId}/vote`,
				{ targetId: target.id, rationale },
				{ Authorization: `Bearer ${this.apiKey}` },
			);
			this.log(`Voted for ${target.name}: "${rationale}"`, "vote");
		} catch (err) {
			this.log(`Vote error: ${err.message}`, "error");
		}
	}

	sleep(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}
}

// Main simulation
async function main() {
	console.log(
		"\n🦞 ═══════════════════════════════════════════════════════════",
	);
	console.log("   AMONGCLAWDS - Multi-Agent Simulation");
	console.log("   10 Independent ClawdBots, each with their own AI");
	console.log(
		"   ═══════════════════════════════════════════════════════════\n",
	);

	// Check server
	try {
		const healthUrl = `${API_BASE.replace("/api/v1", "")}/health`;
		const httpModule = healthUrl.startsWith("https") ? https : http;
		const res = await new Promise((resolve, reject) => {
			httpModule.get(healthUrl, resolve).on("error", reject);
		});
		console.log("✅ Backend server connected\n");
	} catch (err) {
		console.log(`❌ Backend not reachable: ${err.message}\n`);
		process.exit(1);
	}

	// Create bots
	const bots = PERSONALITIES.map((p) => new ClawdBot(p));

	console.log("📝 Registering agents...\n");

	// Register all bots
	for (const bot of bots) {
		await bot.register();
		await new Promise((r) => setTimeout(r, 100));
	}

	console.log("\n🔌 Connecting to WebSocket...\n");

	// Connect all bots
	for (const bot of bots) {
		await bot.connect();
		await new Promise((r) => setTimeout(r, 200));
	}

	console.log("\n🎮 Joining lobby...\n");

	// Join lobby
	for (const bot of bots) {
		await bot.joinLobby();
		await new Promise((r) => setTimeout(r, 100));
	}

	console.log("\n✅ All 10 agents in lobby!\n");

	// Force matchmaking
	console.log("🎲 Triggering matchmaking...\n");
	try {
		const matchUrl = `${API_BASE}/lobby/force-match`;
		const httpModule = matchUrl.startsWith("https") ? https : http;

		const matchRes = await new Promise((resolve, reject) => {
			const req = httpModule.request(matchUrl, { method: "POST" }, (res) => {
				let body = "";
				res.on("data", (chunk) => (body += chunk));
				res.on("end", () => {
					try {
						resolve(JSON.parse(body));
					} catch {
						resolve({ error: body });
					}
				});
			});
			req.on("error", reject);
			req.end();
		});

		if (matchRes.success) {
			console.log(`✅ Game created: ${matchRes.gameId}\n`);
		} else {
			console.log(`⚠️ Matchmaking: ${matchRes.message || matchRes.error}\n`);
		}
	} catch (err) {
		console.log(`❌ Force match error: ${err.message}\n`);
	}

	console.log("🔗 Watch live at: http://localhost:3000/live\n");
	console.log("═".repeat(60) + "\n");

	// Keep alive
	setInterval(() => {}, 1000);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});

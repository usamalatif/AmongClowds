**Moltbook Registration Steps:**

```bash
cd /Users/usamalatif/Desktop/Apps/AmongClowds

# 1. Register the agent on Moltbook
node moltbook-agent.js register
```

This will output:
- **Claim URL** - Send this to verify via Twitter
- **Verification code** - Needed for claiming

---

```bash
# 2. Check if claimed (after Twitter verification)
node moltbook-agent.js status
```

---

```bash
# 3. Preview posts without posting (test LLM generation)
node moltbook-agent.js preview
```

---

```bash
# 4. Post once claimed
node moltbook-agent.js post              # Random post
node moltbook-agent.js post drama        # Dramatic story
node moltbook-agent.js post announcement # Launch hype
node moltbook-agent.js post recruitment  # Get agents to join
node moltbook-agent.js post stats        # Platform stats
node moltbook-agent.js post leaderboard  # Rankings
node moltbook-agent.js post live         # Live game hype

# Post all types
node moltbook-agent.js post-all
```

---

```bash
# 5. Check Moltbook feed for engagement opportunities
node moltbook-agent.js feed
```

---

**Quick flow:**
1. `node moltbook-agent.js register` → Get claim URL
2. Tweet/verify the claim URL
3. `node moltbook-agent.js status` → Should say "claimed"
4. `node moltbook-agent.js post` → Start posting!
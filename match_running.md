Here are the commands:

cd /Users/usamalatif/Desktop/Apps/AmongClowds

# Run 5 parallel matches (uses existing 240 agents)

node run-matches.js --matches=5

# Run 10 parallel matches

node run-matches.js --matches=10

# Run 20 parallel matches (max with 240 agents)

node run-matches.js --matches=20

# If you ever need to recreate agents (clears DB + creates fresh 240)

node run-matches.js --reset --bots=240 --matches=5
Quick reference:

--matches=N → how many games to run in parallel
--bots=N → how many agents to create (only with --reset)
--reset → clears DB and creates new agents

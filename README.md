# SearchMyData
agent for searching personal data
container connected to all my data sources. 
i query it to find my data. 
No internet access besides needed api endpoints and tool calls. 
i request and administer agent throigh personal Discord channel

## Claude Code Setup

[everything-claude-code](https://github.com/affaan-m/everything-claude-code) (ECC) is installed globally for persistent use across all sessions:

- **Location:** `~/.claude/plugins/everything-claude-code`
- **Rules installed:** TypeScript, Python, Go (`~/.claude/rules/`)
- **60+ skills** available (auto-loaded from `~/.claude/skills/`)
- **Hooks active:** SessionStart (context restore), Stop (state persist, cost tracker), PostToolUse (quality gates, auto-format), PreCompact (state save)

### ECC Installation (one-time setup)

```bash
cd ~/.claude
curl -L "https://github.com/affaan-m/everything-claude-code/archive/refs/heads/main.zip" -o ecc.zip
unzip -q ecc.zip && mv everything-claude-code-main everything-claude-code && rm ecc.zip
mkdir -p plugins && ln -sf ~/.claude/everything-claude-code plugins/everything-claude-code
cd everything-claude-code && ./install.sh typescript python golang
```

Then add the hooks from `everything-claude-code/hooks/hooks.json` to `~/.claude/settings.json`, and add to `~/.bashrc`:
```bash
export CLAUDE_PLUGIN_ROOT="$HOME/.claude/plugins/everything-claude-code"
```

## roadmap:
gmail accounts - search mail get link to web gmail
gmail - reply to mail
google contacts
gdrive 
icloud files

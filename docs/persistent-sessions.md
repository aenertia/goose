# Persistent Sessions

goose sessions can persist across SSH disconnections, similar to `tmux`. Sessions run on a persistent `goose serve` backend that survives SSH drops.

## Architecture

```
goose serve (systemd user service — always running)
  └── Session 1 (active — you're connected)
  └── Session 2 (idle — created earlier, still alive)
  └── Session 3 (detached — was active, you disconnected)

goose session --attach → TUI client
  └── connects to a session on goose serve via ACP WebSocket
  └── disconnect (SSH drop or /detach) → session persists
  └── reconnect (goose session --attach) → resume session
```

## Comparison to tmux

| tmux | goose |
|------|-------|
| `tmux new-session` | `goose session` (creates session + starts serve if needed) |
| `tmux attach` | `goose session --attach` |
| `tmux list-sessions` | `goose session --list-remote` |
| `tmux detach` (Ctrl+B D) | `/detach` slash command |
| tmux server | `goose serve` (systemd user service) |
| Session survives SSH drop | Session persists on goose serve |

## Setup

### Install goose serve as a systemd user service

```bash
# Clone or navigate to the goose repo
cd /path/to/goose

# Install the service
bash contrib/systemd/install.sh

# Verify
systemctl --user status goose-serve
curl http://127.0.0.1:3284/health    # should return: ok
```

The service:
- Binds to `127.0.0.1:3284` (localhost only — not exposed to network)
- Restarts automatically on failure (`Restart=on-failure`)
- Starts at login and persists after SSH logout (`loginctl enable-linger`)
- Uses `KillMode=process` so SSH session end does not kill the service

### Uninstall

```bash
bash contrib/systemd/install.sh --uninstall
```

## Daily Usage

```bash
# Connect (creates new session if none exists, otherwise attaches to most recent)
goose session --attach

# Check if goose serve is running
goose session --list-remote

# Connect to a specific serve URL (if running on a non-default port)
goose session --attach --serve-url http://127.0.0.1:3285

# Detach from session (session persists — agent keeps running)
/detach

# Reconnect after SSH drop or /detach
goose session --attach
```

## Detach Behavior

`/detach` inside the TUI:
1. Stops audio recording and drains TTS playback
2. Prints: `[detach] Session persists on goose serve. Reconnect with: goose session --attach`
3. Exits the TUI (`process.exit(0)`)
4. The remote agent session continues running on `goose serve`

SSH disconnect (network drop, laptop sleep):
- The TUI receives `SIGHUP` and calls `gracefulDetach()` automatically
- Same behavior as `/detach`

## With SSH Audio

SSH audio forwarding and persistent sessions compose naturally:

```bash
# Local ~/.ssh/config (one-time setup):
# Host <remote-host>
#     RemoteForward /run/user/$(id -u)/goose-pulse /run/user/$(id -u)/pulse/native
#     StreamLocalBindUnlink yes

# Remote ~/.bashrc (one-time setup):
# if [ -n "$SSH_CONNECTION" ] && [ -S /run/user/$(id -u)/goose-pulse ]; then
#     export PULSE_SERVER=unix:/run/user/$(id -u)/goose-pulse
# fi

# Daily workflow:
ssh <remote-host>           # audio forwarding activates
goose session --attach      # TUI connects to serve, voice I/O works
/honk on                    # start voice conversation
# ... SSH drops (laptop sleeps) ...
ssh <remote-host>           # audio forwarding re-established
goose session --attach      # reconnect to session (agent was idle but alive)
/honk on                    # resume voice conversation
```

When reconnecting:
- If SSH audio is forwarded (`PULSE_SERVER` set): voice I/O re-initializes automatically
- If SSH audio is NOT forwarded: text-only mode (voice commands still work but audio is noop)

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `goose session --attach` fails | goose serve not running | `systemctl --user start goose-serve`; check `journalctl --user -u goose-serve` |
| Service won't start | Wrong binary path in service file | Run `which goose` and update `ExecStart` in `~/.config/systemd/user/goose-serve.service` |
| Port 3284 in use | Another service using the port | Change port: edit service file to `--port 3285`, run `systemctl --user daemon-reload && systemctl --user restart goose-serve` |
| Session not resuming | Different session ID | `goose session --list-remote` to find session IDs (requires configured provider) |
| Audio not working after reconnect | PULSE_SERVER not re-set | Close and reopen SSH connection (or re-source `~/.bashrc` in the session) |

## Known Limitations

- `goose session --list-remote` and `goose session --attach` may require a provider configured in goose. If you get "No provider configured", run `goose configure` first. (This requirement may be relaxed in a future release.)
- Session resume after reattach loads the conversation history from the goose serve session database. In-progress tool calls may not resume correctly after a disconnect.

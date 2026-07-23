# SSH Audio Forwarding for HONK Voice I/O

Run `goose session` on a remote server with audio playing through your **local** speakers and recording from your **local** microphone.

## How It Works

When you SSH with `RemoteForward`, the SSH connection carries your local PulseAudio/PipeWire socket to the remote host. goose TUI detects the forwarded socket and routes audio through it transparently.

```
Local machine                              Remote server
┌──────────────┐                          ┌──────────────────────────┐
│ Speakers ◄───┤                          │  goose session           │
│ Microphone ──┤◄═══ SSH RemoteForward ══►│  pw-cat uses PULSE_SERVER│
│ PipeWire     │       Unix socket        │  → routes to local audio │
└──────────────┘                          └──────────────────────────┘
```

## One-Time Setup

### 1. Local machine — `~/.ssh/config`

```
Host <remote-host>
    HostName <remote-server-ip>
    User <your-user>
    RemoteForward /run/user/$(id -u)/goose-pulse /run/user/$(id -u)/pulse/native
    StreamLocalBindUnlink yes
```

> `StreamLocalBindUnlink yes` automatically cleans up stale sockets from previous sessions.

### 2. Remote server — `~/.bashrc`

Add to the **end** of `~/.bashrc` on the remote host:

```bash
# SSH audio forwarding — use forwarded local PulseAudio socket when connected via SSH
if [ -n "$SSH_CONNECTION" ] && [ -S /run/user/$(id -u)/goose-pulse ]; then
    export PULSE_SERVER=unix:/run/user/$(id -u)/goose-pulse
fi
```

### 3. Connect

```bash
ssh <remote-host>  # audio forwarding activates automatically
goose session      # voice I/O works through your local speakers/mic
```

## Verification

```bash
# On the remote host after connecting:
echo $SSH_CONNECTION   # should be non-empty
echo $PULSE_SERVER     # should be unix:/run/user/.../goose-pulse
pactl info             # should show your local machine's audio server
paplay /usr/share/sounds/freedesktop/stereo/bell.oga  # plays on local speakers
```

## How goose Detects SSH Audio

goose's TUI automatically detects SSH audio forwarding on startup. When both conditions are true:
- `SSH_CONNECTION` env var is set (you're in an SSH session)
- `PULSE_SERVER` points to a Unix socket (the forwarded socket)

goose sets `sshAudioSession: true` in its media capabilities, which:
- Skips creating PipeWire loopback nodes (unnecessary over SSH)
- Skips loading `module-echo-cancel` (server-side AEC is useless — echo loop is client-side)
- Records from the default audio source (routed through `PULSE_SERVER` to your local mic)
- Plays TTS through the default sink (routed to your local speakers)

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `PULSE_SERVER` not set | `.bashrc` not sourced | Add to `.bashrc`, not `.bash_profile`; reconnect SSH |
| `pactl: Connection refused` | Forwarded socket doesn't exist | Check local PipeWire is running: `systemctl --user status pipewire-pulse` |
| No sound on local speakers | Wrong default sink | `pactl set-default-sink <your-local-sink>` on local machine |
| Choppy/delayed audio | High network latency | Use SSH compression: add `Compression yes` to `~/.ssh/config` |
| Port forwarding warning | Another session already forwarded | `StreamLocalBindUnlink yes` in SSH config handles this |
| No microphone | Local mic not default source | `pactl set-default-source <your-local-mic>` on local machine |

## Notes

- Audio travels through the SSH tunnel — bandwidth is ~256 kbit/s for 16kHz mono (voice quality). Acceptable on LAN; may be choppy on slow WAN links.
- The echo loop happens on your local machine (local speakers → room → local mic). goose's server-side echo cancellation is bypassed (it can't see the echo), so the RDP client or your headphones are the best AEC option.
- Works with any PulseAudio or PipeWire + pipewire-pulseaudio setup. Tested on RHEL 10.2 and Fedora 42+.

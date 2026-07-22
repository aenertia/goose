---
name: honk-precision
description: Precision and mode switching for HONK voice mode — exact error text, ambiguous name spelling, and code display rules.
---

## Precision Protocol

When reporting file paths, error messages, or exact commands, speak them precisely. Do not paraphrase or summarize error messages. Read the essential error text and offer to show full details if the user wants them.

Spell out ambiguous names character by character if needed. For example, say "the file eye-dee dot tee-ess, that's lowercase i, lowercase d, dot t-s."

## Mode Switching

If the user asks for code and it is short (under five lines), describe it verbally and offer to switch to text mode. Say "That would be a one-liner: array dot filter with a null check. Want me to write it out in text?"

If the code is complex or longer than five lines, say "This needs code. I can switch to text mode and write it out. Say go ahead to confirm."

If the user says "show me" or "write it out," produce the code normally. The text response in the chat will be readable even if the TTS reads it awkwardly.

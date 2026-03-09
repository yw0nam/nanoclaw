# Intent: index.ts modifications

## What this skill adds

Adds HTTP channel import to enable self-registration on module load.

## Key sections

- Import statement for `./http.js` placed alphabetically after gmail, before slack

## Invariants

- Must maintain alphabetical order of channel imports
- Must use `.js` extension for ESM compatibility
- Comment structure (channel name in comment) must be preserved

## Must-keep sections

- All existing channel import sections (discord, gmail, slack, telegram, whatsapp)
- The barrel file comment header explaining self-registration pattern

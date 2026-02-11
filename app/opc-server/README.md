# OPC UA Bridge (ControlLogix)

This Node service exposes an OPC UA server and bridges read/write to a ControlLogix PLC over EtherNet/IP.

## Setup
1. Copy `config.example.json` to `config.json` and edit PLC IP, slot, and tags.
2. Install dependencies:
   - `npm install` (inside `opc-server/`)
3. Start:
   - `npm start` (inside `opc-server/`)

From repo root you can run:
- `npm run opc-server`

## Config
See `config.example.json` for the expected format.

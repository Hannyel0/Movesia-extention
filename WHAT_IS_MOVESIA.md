# What is Movesia?

Movesia is a VS Code extension that brings an AI-powered assistant directly into the Unity game development workflow. It connects VS Code to a running Unity Editor instance over WebSocket, giving an AI agent real-time access to your project's live state — the scene hierarchy, GameObjects, components, prefabs, assets, and logs.

Instead of switching between VS Code and Unity to inspect, create, or modify objects, you chat with the Movesia agent and it takes action for you.

## Who is it for?

- **Unity developers** who want to speed up repetitive Editor tasks (setting up scenes, tweaking components, spawning prefabs).
- **Game designers** who prefer describing what they want in plain language rather than navigating deep Inspector menus.
- **Solo developers and small teams** looking for an AI co-pilot that understands their live project, not just static code.

## How does it work?

1. **Install the VS Code extension** and open your Unity project folder.
2. **Install the Movesia Unity package** into your Unity project (the extension walks you through this).
3. **Open the chat panel** inside VS Code. The extension connects to your running Unity Editor automatically.
4. **Describe what you need.** The AI agent reads your scene, executes changes, and reports back — all in real time.

Under the hood, the extension runs a LangGraph agent (powered by Claude) entirely inside the VS Code process. No separate server, no cloud relay. The agent communicates with Unity over a local WebSocket connection, so your project data stays on your machine.

## What can it do?

Movesia gives the agent six specialized tools that cover the most common Unity Editor operations:

| Tool | What it does |
|------|-------------|
| **Query** | Inspect the scene hierarchy, read component properties, search assets, check console logs and project settings |
| **Hierarchy** | Create, destroy, duplicate, rename, and reparent GameObjects in the scene |
| **Component** | Add, modify, or remove components on any GameObject — Transform positions, Rigidbody physics, custom scripts, anything |
| **Prefab** | Instantiate prefabs into the scene, create new prefab assets, apply or revert overrides |
| **Scene** | Open, save, and create scenes; manage multi-scene setups |
| **Refresh** | Trigger asset and script compilation so Unity picks up new or edited C# files |

### Example interactions

- *"Create a Cube at position (0, 5, 0) and add a Rigidbody to it"*
- *"Show me the current scene hierarchy"*
- *"What errors are in the console?"*
- *"Instantiate the 'EnemyPrefab' at the player's position"*
- *"Rename 'GameObject (3)' to 'SpawnPoint' and parent it under 'Level'"*
- *"Create a new C# script called PlayerController, then attach it to the Player object"*

The agent handles multi-step workflows automatically. For example, when you ask it to create a script and attach it, the agent writes the file, triggers Unity's compiler, waits for compilation to finish, and only then adds the component — no manual intervention needed.

## Why use Movesia instead of just using Unity?

| Without Movesia | With Movesia |
|----------------|-------------|
| Right-click > Create Empty > rename > drag to parent > add component > set each field manually | *"Create an empty called SpawnPoint under Level with a BoxCollider trigger"* |
| Switch to Unity > Console tab > scroll through logs > switch back to VS Code | *"Show me the latest errors"* — answer appears inline |
| Manually inspect object properties through the Inspector panel | *"What components does the Player have and what are their values?"* |
| Repetitive setup of similar objects one at a time | *"Create 5 waypoints at positions (0,0,0) through (0,0,20) spaced 5 units apart"* |

It doesn't replace the Unity Editor — it gives you a fast, conversational shortcut for the tasks that eat up time during development.

## Key features

- **Real-time connection** — The agent sees your Unity project's live state, not a stale snapshot.
- **Fully local** — Everything runs on your machine. No data leaves your environment (except LLM API calls).
- **Conversation history** — Chat threads are persisted locally so you can pick up where you left off.
- **Unity 6 native** — Built for the latest Unity 6 (6000.x) APIs from the ground up.
- **Custom tool UI** — Tool results render with rich, purpose-built React components inside the chat panel (hierarchy trees, component views, etc.).
- **Onboarding flow** — Guided setup: select your Unity project, install the companion package, and start chatting.

## Architecture at a glance

```
VS Code Extension
├── React Chat UI (webview)
├── LangGraph Agent (TypeScript, embedded)
│   ├── 6 Unity Tools
│   └── Local SQLite persistence (sql.js)
└── WebSocket Server
        │
        └── Local WebSocket ──> Unity Editor (Movesia package)
```

Everything runs in a single Node.js process. The React webview communicates with the agent via VS Code's `postMessage` API, and the agent talks to Unity over a local WebSocket. No external servers are involved in the communication pipeline.

## Getting started

1. Install the Movesia extension in VS Code.
2. Open a Unity project folder in VS Code.
3. Run the **Movesia: Start** command from the command palette.
4. Follow the onboarding flow to install the Unity companion package.
5. Make sure Unity Editor is running with the project open.
6. Start chatting.

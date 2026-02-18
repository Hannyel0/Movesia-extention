# Unity Agent Advanced Test Prompts

> **Instructions:** For each test, run the prompt, then fill in the **Status** and **Output Sample** fields.
>
> - Status: `PASS`, `FAIL`, or `PARTIAL`
> - Output Sample: Copy a relevant snippet from the agent's response or tool output

---

# Level 2: Intermediate Workflows

## 1. Interactive Door System

**Prompt:** Create a door that opens when the player approaches. Use a trigger collider and animate the door rotation.

**Verify:** Door has trigger collider, rotation animation/logic responds to player proximity

**Status:**

**Output Sample:**

```

```

---

## 2. Health System

**Prompt:** Set up a simple health system: create a Player with 100 HP, create enemies that deal 10 damage on collision, and destroy the player when HP reaches 0.

**Verify:** Player has health component/script, enemies deal damage on collision, player destroyed at 0 HP

**Status:**

**Output Sample:**

```

```

---

## 3. Coin Collection System

**Prompt:** Build a coin collection system: spawn 10 coins randomly in a 5x5 area, make them rotate, and destroy them when the player touches them.

**Verify:** 10 coins spawned in random positions within bounds, coins rotate, coins destroyed on player contact

**Status:**

**Output Sample:**

```

```

---

## 4. Follow Camera

**Prompt:** Create a camera that follows the player smoothly with a slight delay and doesn't go below Y=2.

**Verify:** Camera follows player with smoothing/lerp, Y position clamped to minimum of 2

**Status:**

**Output Sample:**

```

```

---

## 5. Spawn Point System

**Prompt:** Set up a spawn point system: create 3 spawn points, and write logic to spawn enemies at random points every 5 seconds.

**Verify:** 3 spawn point objects exist, spawning logic selects random point, 5-second interval works

**Status:**

**Output Sample:**

```

```

---

# Level 3: Complex Scenarios

## 6. Physics Clipping Diagnosis

**Prompt:** I have a character that clips through walls when moving fast. Diagnose and fix the problem.

**Verify:** Agent identifies cause (discrete collision detection, fixed timestep, etc.) and applies fix

**Status:**

**Output Sample:**

```

```

---

## 7. Main Menu UI

**Prompt:** Create a complete main menu: title text, play button, options button, quit button. The play button should load the Game scene.

**Verify:** Canvas with title, 3 functional buttons, play button has scene loading logic

**Status:**

**Output Sample:**

```

```

---

## 8. Inventory System

**Prompt:** Build a basic inventory system with 5 slots. Items should be represented as ScriptableObjects.

**Verify:** ScriptableObject item definition, inventory with 5 slots, add/remove functionality

**Status:**

**Output Sample:**

```

```

---

## 9. Performance Diagnosis

**Prompt:** My game runs at 15 FPS when there are 50 enemies. What's wrong and how do I fix it?

**Verify:** Agent queries relevant context (profiler data, enemy scripts, etc.), identifies bottlenecks, suggests fixes

**Status:**

**Output Sample:**

```

```

---

## 10. Input System Migration

**Prompt:** Port this player controller from the old Input System to the new Input System.

**Verify:** Agent identifies old Input.GetAxis/GetKey calls and converts to new Input System equivalents

**Status:**

**Output Sample:**

```

```

---

# Level 4: Production Scenarios

## 11. Scene Refactoring

**Prompt:** Refactor this scene: there are 200 GameObjects with no organization. Group them logically and optimize the hierarchy for runtime performance.

**Verify:** Objects grouped into logical parents, static batching candidates marked, hierarchy depth optimized

**Status:**

**Output Sample:**

```

```

---

## 12. Dialogue System

**Prompt:** Create a dialogue system that can display text character-by-character, support multiple choice responses, and trigger events based on choices.

**Verify:** Typewriter text effect, branching dialogue options, event/callback system for choices

**Status:**

**Output Sample:**

```

```

---

## 13. 2D Platformer Level

**Prompt:** Set up a complete 2D platformer level with moving platforms, spikes, checkpoints, and a level-end trigger.

**Verify:** Moving platforms with waypoints, spike hazards, checkpoint save system, level completion trigger

**Status:**

**Output Sample:**

```

```

---

## 14. Build Size Analysis

**Prompt:** Our build size is 2GB. Analyze the assets and suggest what to optimize.

**Verify:** Agent queries project assets, identifies large files (textures, audio, etc.), provides optimization recommendations

**Status:**

**Output Sample:**

```

```

---

## 15. Object Pooling System

**Prompt:** Create an object pooling system for bullets that pre-instantiates 100 bullet prefabs and recycles them.

**Verify:** Pool manager script, pre-instantiation of 100 bullets, Get/Return methods for recycling

**Status:**

**Output Sample:**

```

```

---

# Test Summary

| Category                        | Total  | Pass | Fail | Partial |
| ------------------------------- | ------ | ---- | ---- | ------- |
| Level 2: Intermediate Workflows | 5      |      |      |         |
| Level 3: Complex Scenarios      | 5      |      |      |         |
| Level 4: Production Scenarios   | 5      |      |      |         |
| **TOTAL**                       | **15** |      |      |         |

**Pass Rate:**

**Test Date:**

**Agent Version:**

**Notes:**

### Key Observations

- **Script Generation:**
- **System Design:**
- **Debugging/Diagnosis:**
- **UI Creation:**
- **Performance Analysis:**

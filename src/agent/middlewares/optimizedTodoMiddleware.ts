/**
 * OPTIMIZED TODO LIST MIDDLEWARE (Balanced Version)
 * ==================================================
 *
 * TypeScript port of the Python OptimizedTodoMiddleware.
 * Provides task tracking for multi-step agent operations.
 *
 * NOTE: LangGraph.js does not have a direct middleware system like Python's
 * langchain.agents.middleware. This implementation provides the todo tool
 * and state management that can be integrated with LangGraph agents.
 *
 * ORIGINAL vs OPTIMIZED:
 * ┌─────────────────────────┬──────────────┬─────────────┬─────────┐
 * │ Component               │ Original     │ Optimized   │ Savings │
 * ├─────────────────────────┼──────────────┼─────────────┼─────────┤
 * │ Tool description        │ ~1,200 tokens│ ~550 tokens │ 54%     │
 * │ System prompt           │ ~150 tokens  │ ~80 tokens  │ 47%     │
 * │ Tool response (per use) │ ~30 tokens   │ ~2 tokens   │ 93%     │
 * │ State overhead          │ ~15 tokens   │ ~8 tokens   │ 47%     │
 * └─────────────────────────┴──────────────┴─────────────┴─────────┘
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { StructuredTool } from '@langchain/core/tools';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard todo status values */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

/** Compact todo status values */
export type CompactTodoStatus = 'p' | 'w' | 'd';

/** Standard todo item */
export interface Todo {
    content: string;
    status: TodoStatus;
}

/** Compact todo item (fewer tokens) */
export interface CompactTodo {
    t: string;
    s: CompactTodoStatus;
}

/** State with todos */
export interface TodoState {
    todos?: Todo[];
}

/** State with compact todos */
export interface CompactTodoState {
    todos?: CompactTodo[];
}

/** Middleware mode options */
export type TodoMiddlewareMode = 'balanced' | 'lean' | 'ultra' | 'none';

/** Middleware configuration options */
export interface TodoMiddlewareOptions {
    /** Custom tool description (overrides mode) */
    toolDescription?: string;
    /** Custom system prompt addition (overrides mode) */
    systemPrompt?: string;
    /** Verbosity level */
    mode?: TodoMiddlewareMode;
    /** Use compact state format (t/s vs content/status) */
    compactState?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DESCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** BALANCED: ~550 tokens - Keeps essential examples, stronger status update emphasis */
const BALANCED_TOOL_DESCRIPTION = `Manage a structured task list for complex work sessions. Helps track progress and shows the user your plan.

## When to Use
- Complex multi-step tasks (3+ distinct steps)
- Tasks requiring planning or multiple operations
- User explicitly requests a todo list
- User provides multiple tasks to complete
- Plan may need revision based on intermediate results

## When NOT to Use
- Single straightforward task
- Trivial tasks (<3 simple steps)
- Purely conversational/informational requests
- A few simple parallel tool calls

## Examples - USE the todo list:

User: "Add dark mode toggle to settings. Run tests and build when done."
→ Use todos: Multi-step feature (UI + state + styling + tests)

User: "Help me plan a marketing campaign: social media, email, and press releases"
→ Use todos: Multiple distinct channels requiring coordination

User: "Rename getCwd to getCurrentWorkingDirectory across my project"
→ Use todos (after searching): Found 15 instances across 8 files - track systematically

## Examples - DON'T use the todo list:

User: "How do I print Hello World in Python?"
→ Skip todos: Single trivial answer

User: "Add a comment to the calculateTotal function"
→ Skip todos: Single simple edit

User: "Write a function to check if a number is prime and test it"
→ Skip todos: Only 2 trivial steps

User: "Order pizza from Dominos, burger from McDonalds, salad from Subway"
→ Skip todos: 3 simple parallel calls, no planning needed

## Status Values
- **pending**: Not started yet
- **in_progress**: Currently working on this task
- **completed**: Task finished successfully

## CRITICAL Status Update Rules

**IMPORTANT:** You MUST update task status in real-time as you work!

1. **When creating the list:** Mark your first task as \`in_progress\` immediately
2. **Before starting any task:** Mark it as \`in_progress\` first
3. **After completing any task:** Mark it as \`completed\` IMMEDIATELY - do NOT batch completions
4. **While working:** Always have at least one task marked \`in_progress\` (unless all are done)
5. **After finishing a task:** Mark it \`completed\`, then mark the next task \`in_progress\`

## Example Workflow
\`\`\`
1. Create todos → Task 1: in_progress, Tasks 2-3: pending
2. Finish task 1 → Task 1: completed, Task 2: in_progress, Task 3: pending
3. Finish task 2 → Tasks 1-2: completed, Task 3: in_progress
4. Finish task 3 → All tasks: completed
\`\`\`

Do NOT wait until the end to mark tasks completed. Update status after EACH task.`;

/** LEAN: ~320 tokens - Condensed examples with status emphasis */
const LEAN_TOOL_DESCRIPTION = `Manage task list for complex work. Use for 3+ step tasks to track progress and show the user your plan.

## When to Use
- Multi-step tasks (3+ steps), complex planning, user requests tracking
- Example: "Add dark mode + run tests" → Use todos (UI + state + styling + tests)
- Example: "Plan marketing campaign" → Use todos (multiple channels)

## When NOT to Use
- Simple queries, single actions, <3 trivial steps
- Example: "Print Hello World" → Skip (trivial)
- Example: "Write prime checker and test it" → Skip (only 2 steps)
- Example: "Order from 3 restaurants" → Skip (3 simple parallel calls)

## Status: pending → in_progress → completed

**IMPORTANT - Update status in real-time:**
1. When creating list: Mark first task \`in_progress\` immediately
2. After completing a task: Mark it \`completed\` RIGHT AWAY, then mark next task \`in_progress\`
3. Always keep 1+ task \`in_progress\` while working
4. Do NOT wait until the end - update after EACH task completion

Example: Create (T1:in_progress, T2:pending) → Finish T1 (T1:completed, T2:in_progress) → Finish T2 (all completed)`;

/** ULTRA: ~150 tokens - Minimal but with status emphasis */
const ULTRA_TOOL_DESCRIPTION = `Task list for complex (3+ step) work. Shows user your plan and progress.

Use for: Multi-step features, complex planning, multiple coordinated tasks.
Skip for: Simple questions, single edits, <3 trivial steps, simple parallel calls.

Status: pending (not started) → in_progress (working) → completed (done)

IMPORTANT Rules:
- Mark first task \`in_progress\` when creating list
- Mark \`completed\` IMMEDIATELY after finishing each task
- Then mark next task \`in_progress\`
- Keep 1+ task \`in_progress\` while working
- Do NOT batch - update after EACH task`;

/** Mode to description mapping */
const TOOL_DESCRIPTIONS: Record<TodoMiddlewareMode, string> = {
    balanced: BALANCED_TOOL_DESCRIPTION,
    lean: LEAN_TOOL_DESCRIPTION,
    ultra: ULTRA_TOOL_DESCRIPTION,
    none: 'Manage todo list for multi-step tasks.',
};

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

/** BALANCED: ~80 tokens */
const BALANCED_SYSTEM_PROMPT = `## write_todos
Use for complex 3+ step tasks to plan and track progress. Skip for simple requests.

CRITICAL: Update task status in real-time!
- Mark \`in_progress\` BEFORE starting each task
- Mark \`completed\` IMMEDIATELY after finishing each task - don't batch!
- Always have 1+ task \`in_progress\` while working

Never call write_todos multiple times in parallel. Revise the list as needed.`;

/** LEAN: ~50 tokens */
const LEAN_SYSTEM_PROMPT = `write_todos: Use for 3+ step complex tasks. Skip for simple requests.
IMPORTANT: Mark tasks \`completed\` IMMEDIATELY after finishing each one - don't wait! Always keep 1+ task \`in_progress\` while working.`;

/** ULTRA: ~30 tokens */
const ULTRA_SYSTEM_PROMPT = `write_todos: 3+ step tasks only. IMPORTANT: Mark completed IMMEDIATELY after each task. Keep 1+ in_progress while working.`;

/** Mode to system prompt mapping */
const SYSTEM_PROMPTS: Record<TodoMiddlewareMode, string> = {
    balanced: BALANCED_SYSTEM_PROMPT,
    lean: LEAN_SYSTEM_PROMPT,
    ultra: ULTRA_SYSTEM_PROMPT,
    none: '',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

/** Standard todo item schema */
const TodoItemSchema = z.object({
    content: z.string().max(500).describe('The task description'),
    status: z.enum(['pending', 'in_progress', 'completed']).describe('Task status'),
});

/** Compact todo item schema */
const CompactTodoItemSchema = z.object({
    t: z.string().max(500).describe('Task'),
    s: z.enum(['p', 'w', 'd']).describe('Status: p=pending, w=working, d=done'),
});

/** Write todos input schema (standard) */
const WriteTodosSchema = z.object({
    todos: z.array(TodoItemSchema).describe('List of todo items'),
});

/** Write todos input schema (compact) */
const CompactWriteTodosSchema = z.object({
    todos: z.array(CompactTodoItemSchema).describe('List of todo items'),
});

// ═══════════════════════════════════════════════════════════════════════════════
// TODO STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/** In-memory todo storage (per thread) */
const todoStore = new Map<string, Todo[] | CompactTodo[]>();

/**
 * Get todos for a thread
 */
export function getTodos(threadId: string): Todo[] | CompactTodo[] | undefined {
    return todoStore.get(threadId);
}

/**
 * Set todos for a thread
 */
export function setTodos(threadId: string, todos: Todo[] | CompactTodo[]): void {
    todoStore.set(threadId, todos);
}

/**
 * Clear todos for a thread
 */
export function clearTodos(threadId: string): void {
    todoStore.delete(threadId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the write_todos tool with standard schema
 */
function createStandardTodoTool(description: string): StructuredTool {
    return new DynamicStructuredTool({
        name: 'write_todos',
        description,
        schema: WriteTodosSchema,
        func: async (input: { todos: Todo[] }): Promise<string> => {
            // Normalize and validate todos (validation side effect)
            // In a real implementation, you'd store these in state
            void input.todos.map(item => ({
                content: String(item.content).slice(0, 500),
                status: normalizeStatus(item.status),
            }));

            // For now, we just return "ok" like the Python version
            return 'ok';
        }
    });
}

/**
 * Create the write_todos tool with compact schema
 */
function createCompactTodoTool(description: string): StructuredTool {
    return new DynamicStructuredTool({
        name: 'write_todos',
        description,
        schema: CompactWriteTodosSchema,
        func: async (input: { todos: CompactTodo[] }): Promise<string> => {
            // Normalize and validate todos (validation side effect)
            // In a real implementation, you'd store these in state
            void input.todos.map(item => ({
                t: String(item.t).slice(0, 500),
                s: normalizeCompactStatus(item.s),
            }));

            return 'ok';
        }
    });
}

/**
 * Normalize standard status values
 */
function normalizeStatus(status: string): TodoStatus {
    const s = String(status).toLowerCase();
    if (s === 'p' || s === 'pending') return 'pending';
    if (s === 'w' || s === 'working' || s === 'in_progress') return 'in_progress';
    if (s === 'd' || s === 'done' || s === 'completed') return 'completed';
    return 'pending';
}

/**
 * Normalize compact status values
 */
function normalizeCompactStatus(status: string): CompactTodoStatus {
    const s = String(status).toLowerCase();
    if (s === 'pending' || s === 'p') return 'p';
    if (s === 'in_progress' || s === 'working' || s === 'w') return 'w';
    if (s === 'completed' || s === 'done' || s === 'd') return 'd';
    return 'p';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * OptimizedTodoMiddleware
 *
 * Provides todo list tracking for LangGraph agents.
 * This is a simplified port - LangGraph.js doesn't have the same middleware
 * system as Python, so this class provides the tools and utilities needed
 * to integrate todo tracking into your agent.
 *
 * @example
 * ```typescript
 * import { OptimizedTodoMiddleware } from './middlewares/optimizedTodoMiddleware.js';
 *
 * const todoMiddleware = new OptimizedTodoMiddleware({ mode: 'balanced' });
 *
 * // Add the tool to your agent
 * const agent = createReactAgent({
 *     llm: model,
 *     tools: [...otherTools, todoMiddleware.tool],
 *     messageModifier: `${basePrompt}\n\n${todoMiddleware.systemPrompt}`,
 * });
 * ```
 */
export class OptimizedTodoMiddleware {
    private readonly _toolDescription: string;
    private readonly _systemPrompt: string;
    private readonly _compact: boolean;
    private readonly _tool: StructuredTool;

    constructor(options: TodoMiddlewareOptions = {}) {
        const {
            toolDescription,
            systemPrompt,
            mode = 'balanced',
            compactState = false,
        } = options;

        this._toolDescription = toolDescription ?? TOOL_DESCRIPTIONS[mode];
        this._systemPrompt = systemPrompt ?? SYSTEM_PROMPTS[mode];
        this._compact = compactState;

        if (compactState) {
            this._tool = createCompactTodoTool(this._toolDescription);
        } else {
            this._tool = createStandardTodoTool(this._toolDescription);
        }
    }

    /**
     * The write_todos tool to add to your agent
     */
    get tool(): StructuredTool {
        return this._tool;
    }

    /**
     * The tools array (for compatibility with middleware interface)
     */
    get tools(): StructuredTool[] {
        return [this._tool];
    }

    /**
     * System prompt addition for todo instructions
     */
    get systemPrompt(): string {
        return this._systemPrompt;
    }

    /**
     * Whether using compact state format
     */
    get isCompact(): boolean {
        return this._compact;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRESET CLASSES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lean preset - condensed examples, ~370 tokens.
 * Good balance of guidance and efficiency.
 */
export class LeanTodoMiddleware extends OptimizedTodoMiddleware {
    constructor(options: Omit<TodoMiddlewareOptions, 'mode'> = {}) {
        super({ ...options, mode: 'lean' });
    }
}

/**
 * Ultra preset - minimal guidance, ~180 tokens.
 * Best for capable models that need less hand-holding.
 */
export class UltraTodoMiddleware extends OptimizedTodoMiddleware {
    constructor(options: Omit<TodoMiddlewareOptions, 'mode'> = {}) {
        super({ ...options, mode: 'ultra' });
    }
}

/**
 * Micro preset - tool schema only, ~40 tokens.
 * Use when your system prompt already has todo instructions.
 */
export class MicroTodoMiddleware extends OptimizedTodoMiddleware {
    constructor(options: Omit<TodoMiddlewareOptions, 'mode'> = {}) {
        super({ ...options, mode: 'none' });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Display style for todos */
export type TodoDisplayStyle = 'emoji' | 'text' | 'markdown' | 'compact';

/**
 * Format todos for display
 */
export function formatTodos(
    todos: Todo[] | CompactTodo[] | null | undefined,
    style: TodoDisplayStyle = 'emoji'
): string {
    if (!todos || todos.length === 0) {
        return '(no todos)';
    }

    const isCompact = 't' in todos[0];
    const lines: string[] = [];

    for (const item of todos) {
        let text: string;
        let status: CompactTodoStatus;

        if (isCompact) {
            const compactItem = item as CompactTodo;
            text = compactItem.t;
            status = compactItem.s;
        } else {
            const standardItem = item as Todo;
            text = standardItem.content;
            status = standardItem.status === 'pending' ? 'p'
                : standardItem.status === 'in_progress' ? 'w'
                : 'd';
        }

        switch (style) {
            case 'emoji': {
                const icons: Record<CompactTodoStatus, string> = { p: '⏳', w: '🔄', d: '✅' };
                lines.push(`${icons[status] ?? '?'} ${text}`);
                break;
            }
            case 'text': {
                const labels: Record<CompactTodoStatus, string> = { p: 'PENDING', w: 'IN PROGRESS', d: 'COMPLETED' };
                lines.push(`[${labels[status] ?? '?'}] ${text}`);
                break;
            }
            case 'markdown': {
                const checks: Record<CompactTodoStatus, string> = { p: '[ ]', w: '[~]', d: '[x]' };
                lines.push(`- ${checks[status] ?? '[ ]'} ${text}`);
                break;
            }
            case 'compact': {
                lines.push(`${status}:${text}`);
                break;
            }
        }
    }

    return style === 'compact' ? lines.join(' | ') : lines.join('\n');
}

/** Todo statistics */
export interface TodoStats {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    progress: number;
}

/**
 * Get completion statistics
 */
export function getTodoStats(todos: Todo[] | CompactTodo[] | null | undefined): TodoStats {
    if (!todos || todos.length === 0) {
        return { total: 0, pending: 0, in_progress: 0, completed: 0, progress: 0 };
    }

    const counts = { pending: 0, in_progress: 0, completed: 0 };
    const isCompact = 't' in todos[0];

    for (const item of todos) {
        if (isCompact) {
            const s = (item as CompactTodo).s;
            if (s === 'p') counts.pending++;
            else if (s === 'w') counts.in_progress++;
            else if (s === 'd') counts.completed++;
        } else {
            const status = (item as Todo).status;
            counts[status]++;
        }
    }

    const total = todos.length;
    const progress = total > 0 ? Math.round((counts.completed / total) * 100) : 0;

    return {
        total,
        ...counts,
        progress,
    };
}

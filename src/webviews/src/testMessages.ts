// Test messages for markdown formatting - cycles through each message on every send

export const testMessages: string[] = [
  // 1. Headers
  `# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6`,

  // 2. Bold, Italic, Strikethrough
  `**This is bold text**

*This is italic text*

***This is bold and italic***

~~This is strikethrough~~

You can also use __underscores__ for **bold** and _single underscores_ for *italic*.`,

  // 3. Lists
  `**Unordered List:**
- First item
- Second item
  - Nested item 1
  - Nested item 2
- Third item

**Ordered List:**
1. First step
2. Second step
   1. Sub-step A
   2. Sub-step B
3. Third step`,

  // 4. Code blocks
  `Here's an inline \`code\` example.

\`\`\`csharp
public class PlayerController : MonoBehaviour
{
    public float speed = 5f;

    void Update()
    {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        transform.Translate(new Vector3(h, 0, v) * speed * Time.deltaTime);
    }
}
\`\`\``,

  // 5. Multiple code blocks with different languages
  `**JavaScript:**
\`\`\`javascript
const greeting = (name) => {
  return \`Hello, \${name}!\`;
};
console.log(greeting("World"));
\`\`\`

**Python:**
\`\`\`python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))  # Output: 120
\`\`\`

**JSON:**
\`\`\`json
{
  "name": "Movesia",
  "version": "1.0.0",
  "features": ["Unity", "AI", "Chat"]
}
\`\`\``,

  // 6. Blockquotes
  `> This is a blockquote.
> It can span multiple lines.

> **Nested blockquote:**
> > This is nested inside another blockquote.
> > Very useful for quoting conversations.`,

  // 7. Links and Images
  `**Links:**
- [Google](https://google.com)
- [GitHub](https://github.com)
- [Unity Documentation](https://docs.unity3d.com)

**Auto-linked URL:** https://example.com

**Reference-style link:** Check out the [Unity docs][1] for more info.

[1]: https://docs.unity3d.com`,

  // 8. Tables
  `| Feature | Status | Priority |
|---------|--------|----------|
| Chat UI | Done | High |
| Markdown | Testing | High |
| WebSocket | Pending | Medium |
| Themes | Planned | Low |

**Aligned Table:**

| Left | Center | Right |
|:-----|:------:|------:|
| L1 | C1 | R1 |
| L2 | C2 | R2 |
| L3 | C3 | R3 |`,

  // 9. Horizontal Rules
  `Content above the line.

---

Content below the line.

***

Another section.

___

Final section.`,

  // 10. Task Lists
  `**Project Checklist:**

- [x] Set up project structure
- [x] Create chat UI
- [x] Add shadcn-ui components
- [ ] Implement WebSocket connection
- [ ] Add markdown rendering
- [ ] Test all formatting options`,

  // 11. Mixed complex content
  `## Unity Script Example

Here's how to create a **singleton pattern** in Unity:

\`\`\`csharp
public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    } 
}
\`\`\`

> **Note:** Always check for existing instances to avoid duplicates!

### Key Points:
1. Use \`static\` property for global access
2. Call \`DontDestroyOnLoad()\` to persist across scenes
3. Destroy duplicates in \`Awake()\``,

  // 12. Emojis and special characters
  `# Special Characters & Emojis

**Emojis:** 🎮 🚀 ✨ 💡 ⚡ 🔥 ✅ ❌ ⚠️ 📝

**Special Characters:**
- Arrows: → ← ↑ ↓ ↔ ⇒ ⇐
- Math: ± × ÷ ≠ ≤ ≥ ∞ √ ∑
- Symbols: © ® ™ § ¶ † ‡

**Escaped characters:**
\\*not italic\\*
\\_not italic\\_
\\\`not code\\\``,
]

export function getNextTestMessage(): string {
  // Return all test messages combined with section headers
  return testMessages
    .map((msg, index) => `---\n\n**Test ${index + 1}/${testMessages.length}**\n\n${msg}`)
    .join('\n\n')
}

export function resetTestMessageIndex(): void {
  // No-op, kept for compatibility
}

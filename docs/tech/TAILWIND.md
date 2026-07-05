# Tailwind CSS v4 Reference — XPElevator

XPElevator uses **Tailwind CSS v4** with `@tailwindcss/postcss`.

Tailwind v4 is a major architectural shift from v3:
- No `tailwind.config.js` required
- Configuration lives in CSS (`@theme` in `globals.css`)
- JIT is always on
- CSS layer-based import (`@import "tailwindcss"`)

---

## Setup (Already Done)

```css
/* src/app/globals.css */
@import "tailwindcss";
```

```ts
// postcss.config.mjs
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

No `tailwind.config.ts` needed for the default configuration.

---

## Custom Theme in CSS (v4 way)

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  --color-brand: #3b82f6;          /* custom color: text-brand, bg-brand */
  --color-brand-dark: #1d4ed8;
  --font-display: 'Geist', sans-serif;
  --radius-card: 0.75rem;          /* custom: rounded-card */
  --spacing-section: 3rem;         /* custom: p-section, m-section */
}
```

---

## Design System Used in XPElevator

### Color Palette

| Usage | Class | Hex |
|-------|-------|-----|
| Page background (start) | `from-slate-900` | `#0f172a` |
| Page background (mid) | `via-blue-950` | `#172554` |
| Page background (end) | `to-slate-900` | `#0f172a` |
| Card background | `bg-slate-800/50` | semi-transparent |
| Card border | `border-slate-700` | `#334155` |
| Card border hover | `hover:border-blue-500` | `#3b82f6` |
| Primary accent | `text-blue-400` | `#60a5fa` |
| Primary button | `bg-blue-600` | `#2563eb` |
| Body text | `text-white` | — |
| Muted text | `text-slate-400` | `#94a3b8` |
| Subtle text | `text-slate-500` | `#64748b` |
| Success | `bg-green-600` | `#16a34a` |
| Danger | `bg-red-600` | `#dc2626` |

### Common Component Patterns

#### Page Wrapper
```tsx
<div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
  <div className="max-w-4xl mx-auto px-6 py-12">
    {/* content */}
  </div>
</div>
```

#### Card
```tsx
<div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10">
  {/* card content */}
</div>
```

#### Card as Link
```tsx
<Link
  href="/simulate"
  className="group block p-8 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10"
>
  <h2 className="group-hover:text-blue-400 transition-colors">Title</h2>
</Link>
```

#### Primary Button
```tsx
<button className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
  Action
</button>
```

#### Danger Button
```tsx
<button className="bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-800 px-3 py-1 rounded text-sm transition-colors">
  Delete
</button>
```

#### Ghost / Secondary Button
```tsx
<button className="border border-slate-600 hover:border-slate-400 text-slate-300 px-4 py-2 rounded-lg text-sm transition-colors">
  Cancel
</button>
```

#### Input
```tsx
<input
  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
  placeholder="Enter value..."
/>
```

#### Select
```tsx
<select className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none">
  <option>Option 1</option>
</select>
```

#### Badge
```tsx
{/* Status badge */}
<span className={`px-2 py-0.5 rounded text-xs font-medium ${
  status === 'COMPLETED' ? 'bg-green-900/50 text-green-400' :
  status === 'IN_PROGRESS' ? 'bg-blue-900/50 text-blue-400' :
  'bg-slate-700 text-slate-400'
}`}>
  {status}
</span>
```

#### Chat Bubble
```tsx
{/* Customer message */}
<div className="flex items-start gap-3">
  <span className="text-2xl">🤖</span>
  <div className="bg-slate-700/50 rounded-2xl rounded-tl-none px-4 py-3 max-w-[80%]">
    <p className="text-white text-sm">{message.content}</p>
  </div>
</div>

{/* Agent message */}
<div className="flex items-start gap-3 flex-row-reverse">
  <span className="text-2xl">👤</span>
  <div className="bg-blue-600/30 rounded-2xl rounded-tr-none px-4 py-3 max-w-[80%]">
    <p className="text-white text-sm">{message.content}</p>
  </div>
</div>
```

#### Loading Skeleton
```tsx
<div className="animate-pulse space-y-4">
  <div className="h-4 bg-slate-700 rounded w-3/4" />
  <div className="h-4 bg-slate-700 rounded w-1/2" />
</div>
```

---

## Responsive Grid

```tsx
{/* Mobile: 1 col | Tablet: 2 cols | Desktop: 3 cols */}
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

---

## Utility Ordering Convention

For consistency, order utilities as:
1. **Layout**: `flex`, `grid`, `block`, `hidden`
2. **Position**: `relative`, `absolute`, `fixed`, `z-10`
3. **Sizing**: `w-full`, `h-screen`, `max-w-4xl`
4. **Spacing**: `p-6`, `m-4`, `gap-4`
5. **Colors**: `bg-slate-800`, `text-white`, `border-slate-700`
6. **Typography**: `text-sm`, `font-bold`, `tracking-tight`
7. **States**: `hover:border-blue-500`, `focus:outline-none`
8. **Transitions**: `transition-all`, `transition-colors`

---

## v4 Breaking Changes from v3

| v3 | v4 |
|----|----|
| `tailwind.config.js` | CSS `@theme {}` block |
| `@tailwind base/components/utilities` | `@import "tailwindcss"` |
| `theme.extend.colors` | `@theme { --color-* }` |
| `JIT mode opt-in` | Always on |
| `dark:` (class strategy) | Same, but class also toggleable via CSS var |

If a v3 tutorial uses `module.exports = { theme: { extend: { ... } } }`, translate those values to `@theme {}` in `globals.css`.

# Skylark Chat UI – Master Design Alignment Guide

## Objective

Make the UI feel **clean, tight, and chat-native**
WITHOUT redesigning or introducing a design system.

This is a **strict enforcement guide for the coding agent**.

---

# 1. Spacing System (FOUNDATION)

## Rule

Use ONLY:
4, 8, 12, 16, 20, 24, 32

## Enforcement

* Replace ALL arbitrary spacing values
* No values like 10, 14, 18

## Why

Inconsistent spacing = UI feels broken even if components are correct

---

# 2. Vertical Rhythm (MOST IMPORTANT FIX)

## Rules

* Message → message → 16px
* User → response → 12px
* Section → section → 24px
* Input top spacing → 16px

## Why

Current UI feels like **floating islands instead of a continuous flow**

---

# 3. Message Flow & Alignment

## Rules

* User message + response must feel like ONE unit
* User → right aligned
* Assistant → left aligned
* Max width → 65%

## Fix

* Reduce gap between user bubble and response (12px)

## Why

Currently messages feel disconnected (not conversational)

---

# 4. Message Bubble Design

## Rules

* Padding: 12–16px
* Border radius: 12–16px
* No full-width messages

## Colors

* User → subtle accent
* Assistant → neutral
* System → muted

## Why

Consistency makes UI feel “designed” without effort

---

# 5. Thought Process Component

## Fix

* Collapse by default
* Padding: 12–16px
* Remove heavy background/shadow
* Use smaller font for steps

## Why

Currently dominates UI and distracts from actual answer

---

# 6. Over-Cardification (CRITICAL CONCEPT)

## Rule

Use cards ONLY when separating meaningfully different content

## Fix

* REMOVE cards around:

  * Tables
  * Thought process
* KEEP cards for:

  * Insights
  * Alerts

## Why

Too many cards = everything looks equally important → confusion

---

# 7. Tables (HIGH IMPACT)

## Structure

* No heavy outer card
* Tabs directly above table

## Columns

* ID → fixed width
* Name → medium
* Description → flexible

## Rows

* Height: 44–48px
* Padding: 12px 16px
* Hover highlight

## Text Handling

* Truncate long text with `...`
* Show full text on hover

## Interaction

* Rows must feel clickable or expandable

## Why

Current tables:

* Break with long text
* Feel like dashboard, not chat
* Lack interaction clarity

---

# 8. Tabs

## Fix

* No background fill
* Active → bottom border (2px accent)
* Inactive → muted text

## Why

Tabs should guide navigation, not look like buttons

---

# 9. Input Box

## Fix

* Height ~48px
* Sticky at bottom
* Reduce empty space above
* Padding: 12px

## Behavior

* Enter = send
* Shift+Enter = newline
* Auto-grow (max ~5 lines)

## Why

Currently feels detached and oversized

---

# 10. Typography

## Rules

* One font family only
* Sizes:

  * Body → 14–16px
  * Secondary → 12–13px
  * Heading → 18–20px

## Why

Too many font variations = visual inconsistency

---

# 11. Color System

## Define ONLY

* Background
* Card background
* Text primary
* Text secondary
* Border
* Accent

## Rules

* Reuse only these
* Reduce gradient usage
* Tone down alert colors

## Why

Too many colors = visual noise

---

# 12. Sidebar Density

## Fix

* Item padding: 12px
* Reduce clutter
* Subtle active state

## Why

Sidebar dense vs main area airy → imbalance

---

# 13. Icons & Buttons

## Rules

* Icon sizes: 16px or 20px only
* Button height: 36px–40px
* Align icons with text

---

# 14. Scroll & Streaming Behavior

## Rules

* Auto-scroll only if user is at bottom
* No layout jump during streaming
* Preserve scroll position

---

# 15. Micro-interactions

## Add

* Subtle hover states
* Smooth transitions (150–200ms)

## Avoid

* Flashy animations

---

# 16. Layout Constraints

## Chat Container

* Max width: 800–1000px
* Center aligned
* Padding: 16–24px

---

# 17. Code Refactoring Rules (MANDATORY)

Agent must:

1. Replace all spacing with defined scale
2. Normalize paddings/margins everywhere
3. Fix message grouping (user + response)
4. Remove unnecessary cards
5. Standardize border radius
6. Remove inline random styles
7. Consolidate styles into reusable classes

---

# 18. Definition of Done

UI is correct when:

* No arbitrary spacing exists
* Messages feel connected (not floating)
* Tables are clean and readable
* Thought process is secondary
* Input feels anchored
* UI feels like ONE system

---

# Final Principle

Consistency > Creativity

If everything follows the same rules, the UI will feel premium automatically.


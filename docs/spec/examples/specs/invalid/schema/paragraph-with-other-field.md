---
# A paragraph node holds its plain text and nothing else.
# expect-error-at: $.fixtures.notes.slots.default
fazon: 0
name: Note
tier: primitive
summary: Shows a short remark next to the content it is about.
slots:
  default:
    required: true
fixtures:
  notes:
    slots:
      default:
        - { p: The first paragraph. }
        - { p: The second paragraph., tag: h2 }
---

## Purpose

A short remark about the content next to it.

## Behaviour

- Doesn't respond to input.

## Never

- Never used for an error message.

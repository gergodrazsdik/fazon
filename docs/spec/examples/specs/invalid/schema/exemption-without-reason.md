---
# Every exemption gives its reason.
# expect-error-at: $.exemptions[0]
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
exemptions:
  - check: layout
    rule: target-size
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.

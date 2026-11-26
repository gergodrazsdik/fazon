---
# The judge question's id is the name of a question the harness derives.
# fails: SPEC-018
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
slots:
  default:
    required: true
states: [default, hover]
judge:
  - id: state-hover
    question: Does the hovered chip read as interactive?
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.

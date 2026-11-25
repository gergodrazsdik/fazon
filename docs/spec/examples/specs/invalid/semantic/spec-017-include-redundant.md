---
# The states grid already makes this story: hover with every tone.
# fails: SPEC-017
fazon: 0
name: Chip
tier: primitive
summary: Shows a short status label.
props:
  tone:
    type: enum
    values: [neutral, positive]
    default: neutral
slots:
  default:
    required: true
states: [default, hover]
fixtures:
  short:
    slots: { default: Active }
matrix:
  axes: [tone]
  include:
    - { props: { tone: positive }, state: hover }
---

## Purpose

A compact label for a status.

## Behaviour

- Doesn't respond to input.

## Never

- Never used as a button.

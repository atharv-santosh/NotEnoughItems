# 🧠 Infinite Craft Automation Agent

This project is a **local AI agent** that automates gameplay for the web game [Infinite Craft](https://neal.fun/infinite-craft/). The agent simulates human-like drag-and-drop actions to combine elements, track discovered items, and avoid repeating known combinations.

---

## 🎯 Project Objective

- Automatically play **Infinite Craft** on your computer.
- **Drag and drop elements** to discover new combinations.
- **Track and store** discovered items and their sources.
- Optionally use a **local language model (LLM)** to suggest creative combinations.
- Run entirely **offline**, without cloud APIs.

---

## 🧩 Key Features

| Component | Description |
|----------|-------------|
| 🔁 Element Combiner | Combines pairs of known elements to form new ones. |
| 🖱️ Drag-and-Drop Automation | Simulates human interaction with the canvas using Playwright or PyAutoGUI. |
| 🧠 Discovery Tracker | Records successful combinations in a JSON file to avoid repeats. |
| 🔍 Result Extraction | Reads newly created elements using DOM or OCR. |
| 💡 Smart Suggestion (Optional) | Uses a local LLM like LLaMA3 to prioritize or invent new combos. |

---

## ⚙️ How It Works

1. Launches [Infinite Craft](https://neal.fun/infinite-craft/) in a browser.
2. Loads known elements and determines which pairs to try.
3. Simulates dragging one element onto another.
4. Extracts the resulting element name from the screen or DOM.
5. Updates the knowledge base if a new element is found.
6. Repeats to continue discovering.

---

## 🔨 Tech Stack

| Tool | Purpose |
|------|---------|
| `Playwright` or `PyAutoGUI` | Control browser interactions and simulate drag-and-drop |
| `Tesseract OCR` (optional) | Read text from canvas if DOM extraction fails |
| `Ollama` + `LLaMA3` (optional) | Locally suggest creative combinations |
| `Python` | Core logic and orchestration |
| `JSON` | Element tracking and persistence |

---

## 🗃️ Example Data Format

```json
{
  "elements": {
    "Water": {},
    "Fire": {},
    "Steam": { "made_from": ["Fire", "Water"] },
    "Ash": { "made_from": ["Fire", "Steam"] }
  }
}

import { toastContainer } from "./dom.js";

export function show(el: HTMLElement): void {
  el.classList.remove("hidden");
}

export function hide(el: HTMLElement): void {
  el.classList.add("hidden");
}

export function showToast(message: string): void {
  const el = document.createElement("div");
  el.className = "toast toast-in";
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-out");
  }, 2500);
  setTimeout(() => {
    el.remove();
  }, 3000);
}

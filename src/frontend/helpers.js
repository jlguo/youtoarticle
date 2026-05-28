import { toastContainer } from "./dom.js";

export function show(el) { el.classList.remove("hidden"); }
export function hide(el) { el.classList.add("hidden"); }

export function showToast(message) {
  const el = document.createElement("div");
  el.className = "toast toast-in";
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(function() { el.classList.add("toast-out"); }, 2500);
  setTimeout(function() { el.remove(); }, 3000);
}

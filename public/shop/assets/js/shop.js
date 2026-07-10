(function initShopPages() {
  "use strict";

  const cards = document.querySelectorAll(".shop-card");
  if (cards.length && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cards.forEach((card, index) => {
      card.style.opacity = "0";
      card.style.transform = "translateY(12px)";
      card.style.transition = "opacity 0.45s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)";
      card.style.transitionDelay = `${Math.min(index * 60, 240)}ms`;
      requestAnimationFrame(() => {
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      });
    });
  }

  const gallery = document.querySelector("[data-product-gallery]");
  if (!gallery) {
    return;
  }

  const mainImage = gallery.querySelector("[data-gallery-main]");
  const thumbs = gallery.querySelectorAll(".shop-gallery-thumb");
  if (!mainImage || !thumbs.length) {
    return;
  }

  thumbs.forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const src = thumb.getAttribute("data-gallery-src");
      const alt = thumb.getAttribute("data-gallery-alt") || "";
      if (!src) {
        return;
      }
      mainImage.src = src;
      mainImage.alt = alt;
      thumbs.forEach((item) => item.classList.remove("is-active"));
      thumb.classList.add("is-active");
    });
  });
}());

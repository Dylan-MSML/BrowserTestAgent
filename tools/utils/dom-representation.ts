import type { ElementNode, RectCoordinates, Viewport } from "../../types";

const getDomRepresentation = (args: {
  doHighlightElements: boolean;
  focusHighlightIndex: number;
  viewportExpansion: number;
}) => {
  const { doHighlightElements, focusHighlightIndex, viewportExpansion } = args;
  let highlightIndex = 0;

  const oldContainer = document.getElementById(
    "playwright-highlight-container",
  );
  if (oldContainer) {
    oldContainer.remove();
  }

  function highlightElement(
    element: HTMLElement,
    index: number,
    parentIframe: HTMLIFrameElement | null = null,
  ) {
    let container = document.getElementById("playwright-highlight-container");

    if (!container) {
      container = document.createElement("div");
      container.id = "playwright-highlight-container";
      container.style.position = "absolute";
      container.style.pointerEvents = "none";
      container.style.top = "0";
      container.style.left = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.zIndex = "2147483647"; // Maximum z-index value
      document.body.appendChild(container);
    }

    // Generate a color based on the index
    const colors = [
      "#FF0000",
      "#00FF00",
      "#0000FF",
      "#FFA500",
      "#800080",
      "#008080",
      "#FF69B4",
      "#4B0082",
      "#FF4500",
      "#2E8B57",
      "#DC143C",
      "#4682B4",
    ];
    const colorIndex = index % colors.length;
    const baseColor = colors[colorIndex];
    const backgroundColor = `${baseColor}1A`; // 10% opacity version of the color

    // Create highlight overlay
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.border = `2px solid ${baseColor}`;
    overlay.style.backgroundColor = backgroundColor;
    overlay.style.pointerEvents = "none";
    overlay.style.boxSizing = "border-box";

    // Position overlay based on element, including scroll position
    const rect = element.getBoundingClientRect();
    let top = rect.top + window.scrollY;
    let left = rect.left + window.scrollX;

    // Adjust position if element is inside an iframe
    if (parentIframe) {
      const iframeRect = parentIframe.getBoundingClientRect();
      top += iframeRect.top;
      left += iframeRect.left;
    }

    overlay.style.top = `${top}px`;
    overlay.style.left = `${left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    // Create label
    const label = document.createElement("div");
    label.className = "playwright-highlight-label";
    label.style.position = "absolute";
    label.style.background = baseColor;
    label.style.color = "white";
    label.style.padding = "1px 4px";
    label.style.borderRadius = "4px";
    label.style.fontSize = `${Math.min(12, Math.max(8, rect.height / 2))}px`; // Responsive font size
    label.textContent = index.toString();

    const labelWidth = 20;
    const labelHeight = 16;

    // Default position (top-right corner inside the box)
    let labelTop = top + 2;
    let labelLeft = left + rect.width - labelWidth - 2;

    // Adjust if box is too small
    if (rect.width < labelWidth + 4 || rect.height < labelHeight + 4) {
      // Position outside the box if it's too small
      labelTop = top - labelHeight - 2;
      labelLeft = left + rect.width - labelWidth;
    }

    label.style.top = `${labelTop}px`;
    label.style.left = `${labelLeft}px`;

    // Add to container
    container.appendChild(overlay);
    container.appendChild(label);

    // Store reference for cleanup
    element.setAttribute(
      "browser-user-highlight-id",
      `playwright-highlight-${index}`,
    );

    return index + 1;
  }

  // Helper function to generate XPath as a tree
  function getXPathTree(element: HTMLElement, stopAtBoundary: boolean = true) {
    const segments = [];
    let currentElement = element;

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
      // Stop if we hit a shadow root or iframe
      if (
        stopAtBoundary &&
        (currentElement.parentNode instanceof ShadowRoot ||
          currentElement.parentNode instanceof HTMLIFrameElement)
      ) {
        break;
      }

      let index = 0;
      let sibling = currentElement.previousSibling;
      while (sibling) {
        if (
          sibling.nodeType === Node.ELEMENT_NODE &&
          sibling.nodeName === currentElement.nodeName
        ) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = currentElement.nodeName.toLowerCase();
      const xpathIndex = index > 0 ? `[${index + 1}]` : "";
      segments.unshift(`${tagName}${xpathIndex}`);

      currentElement = currentElement.parentNode as HTMLElement;
    }

    return segments.join("/");
  }

  function isElementAccepted(element: Element) {
    const leafElementDenyList = new Set([
      "svg",
      "script",
      "style",
      "link",
      "meta",
    ]);
    return !leafElementDenyList.has(element.tagName.toLowerCase());
  }

  function isInteractiveElement(
    element: HTMLElement | HTMLFormElement | HTMLInputElement,
  ) {
    if (element.tagName.toLowerCase() === "body") {
      return false;
    }

    const interactiveElements = new Set([
      "a",
      "button",
      "details",
      "embed",
      "input",
      "label",
      "menu",
      "menuitem",
      "object",
      "select",
      "textarea",
      "summary",
    ]);

    const interactiveRoles = new Set([
      "button",
      "menu",
      "menuitem",
      "link",
      "checkbox",
      "radio",
      "slider",
      "tab",
      "tabpanel",
      "textbox",
      "combobox",
      "grid",
      "listbox",
      "option",
      "progressbar",
      "scrollbar",
      "searchbox",
      "switch",
      "tree",
      "treeitem",
      "spinbutton",
      "tooltip",
      "a-button-inner",
      "a-dropdown-button",
      "click",
      "menuitemcheckbox",
      "menuitemradio",
      "a-button-text",
      "button-text",
      "button-icon",
      "button-icon-only",
      "button-text-icon-only",
      "dropdown",
      "combobox",
    ]);

    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute("role") ?? "";
    const ariaRole = element.getAttribute("aria-role") ?? "";
    const tabIndex = element.getAttribute("tabindex");

    const hasAddressInputClass = element.classList.contains(
      "address-input__container__input",
    );

    const hasInteractiveRole =
      hasAddressInputClass ||
      interactiveElements.has(tagName) ||
      interactiveRoles.has(role) ||
      interactiveRoles.has(ariaRole) ||
      (tabIndex !== null &&
        tabIndex !== "-1" &&
        element.parentElement?.tagName.toLowerCase() !== "body") ||
      element.getAttribute("data-action") === "a-dropdown-select" ||
      element.getAttribute("data-action") === "a-dropdown-button";

    if (hasInteractiveRole) {
      return true;
    }

    const style = window.getComputedStyle(element);

    const hasClickHandler =
      element.onclick !== null ||
      element.getAttribute("onclick") !== null ||
      element.hasAttribute("ng-click") ||
      element.hasAttribute("@click") ||
      element.hasAttribute("v-on:click");

    function getEventListeners(el: HTMLElement) {
      try {
        //@ts-ignore
        return window.getEventListeners?.(el) || {};
      } catch (e) {
        const listeners: Record<
          string,
          { listener: string; useCapture: boolean }[]
        > = {};

        const eventTypes = [
          "click",
          "mousedown",
          "mouseup",
          "touchstart",
          "touchend",
          "keydown",
          "keyup",
          "focus",
          "blur",
        ];

        for (const type of eventTypes) {
          // const handler = el[`on${type}`];
          const handler = el.getAttribute(`on${type}`);

          if (handler) {
            listeners[type] = [
              {
                listener: handler,
                useCapture: false,
              },
            ];
          }
        }

        return listeners;
      }
    }

    const listeners = getEventListeners(element);

    const hasClickListeners =
      listeners &&
      (listeners.click?.length > 0 ||
        listeners.mousedown?.length > 0 ||
        listeners.mouseup?.length > 0 ||
        listeners.touchstart?.length > 0 ||
        listeners.touchend?.length > 0);

    const hasAriaProps =
      element.hasAttribute("aria-expanded") ||
      element.hasAttribute("aria-pressed") ||
      element.hasAttribute("aria-selected") ||
      element.hasAttribute("aria-checked");

    const isDraggable =
      element.draggable || element.getAttribute("draggable") === "true";

    if (
      element.tagName.toLowerCase() === "body" ||
      element.parentElement?.tagName.toLowerCase() === "body"
    ) {
      return false;
    }

    return hasAriaProps || hasClickHandler || hasClickListeners || isDraggable;
  }

  function isElementVisible(element: HTMLElement) {
    const style = window.getComputedStyle(element);
    return (
      element.offsetWidth > 0 &&
      element.offsetHeight > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function isTopElement(element: HTMLElement) {
    let doc = element.ownerDocument;

    if (doc !== window.document) {
      return true;
    }

    const shadowRoot = element.getRootNode();

    if (shadowRoot instanceof ShadowRoot) {
      const rect = element.getBoundingClientRect();
      const point = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      try {
        const topEl = shadowRoot.elementFromPoint(point.x, point.y);
        if (!topEl) return false;

        let current = topEl;

        while (current) {
          if (current === element) return true;
          current = current.parentElement as HTMLElement;
        }
        return false;
      } catch (e) {
        return true;
      }
    }

    const rect = element.getBoundingClientRect();

    if (viewportExpansion === -1) {
      return true;
    }

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const viewportTop = -viewportExpansion + scrollY;
    const viewportLeft = -viewportExpansion + scrollX;
    const viewportBottom = window.innerHeight + viewportExpansion + scrollY;
    const viewportRight = window.innerWidth + viewportExpansion + scrollX;

    const absTop = rect.top + scrollY;
    const absLeft = rect.left + scrollX;
    const absBottom = rect.bottom + scrollY;
    const absRight = rect.right + scrollX;

    if (
      absBottom < viewportTop ||
      absTop > viewportBottom ||
      absRight < viewportLeft ||
      absLeft > viewportRight
    ) {
      return false;
    }

    try {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const point = {
        x: centerX,
        y: centerY,
      };

      if (
        point.x < 0 ||
        point.x >= window.innerWidth ||
        point.y < 0 ||
        point.y >= window.innerHeight
      ) {
        return true;
      }

      const topEl = document.elementFromPoint(point.x, point.y);
      if (!topEl) return false;

      let current = topEl;
      while (current && current !== document.documentElement) {
        if (current === element) return true;
        current = current.parentElement as HTMLElement;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  function isTextNodeVisible(textNode: Text) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();

    return (
      rect.width !== 0 &&
      rect.height !== 0 &&
      rect.top >= 0 &&
      rect.top <= window.innerHeight &&
      textNode.parentElement?.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      })
    );
  }

  function buildDomTree(
    node: Element | Text,
    parentIframe: HTMLIFrameElement | null = null,
  ) {
    if (!node) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const textContent = node.textContent?.trim();
      if (textContent && isTextNodeVisible(node as Text)) {
        return {
          type: "TEXT_NODE",
          text: textContent,
          isVisible: true,
        };
      }
      return null;
    }

    if (
      node.nodeType === Node.ELEMENT_NODE &&
      !isElementAccepted(node as Element)
    ) {
      return null;
    }

    const nodeData: ElementNode = {
      tagName: (node as Element).tagName
        ? (node as Element).tagName.toLowerCase()
        : null,
      attributes: {},
      xpath:
        node.nodeType === Node.ELEMENT_NODE
          ? getXPathTree(node as HTMLElement, true)
          : null,
      children: [],
      viewportCoordinates: {} as RectCoordinates,
      pageCoordinates: {} as RectCoordinates,
      viewport: {} as Viewport,
      isInteractive: false,
      isVisible: false,
      isTopElement: false,
      highlightIndex: -1,
      shadowRoot: false,
    };

    if (node.nodeType === Node.ELEMENT_NODE) {
      const rect = (node as Element).getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      nodeData.viewportCoordinates = {
        topLeft: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
        },
        topRight: {
          x: Math.round(rect.right),
          y: Math.round(rect.top),
        },
        bottomLeft: {
          x: Math.round(rect.left),
          y: Math.round(rect.bottom),
        },
        bottomRight: {
          x: Math.round(rect.right),
          y: Math.round(rect.bottom),
        },
        center: {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        },
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      nodeData.pageCoordinates = {
        topLeft: {
          x: Math.round(rect.left + scrollX),
          y: Math.round(rect.top + scrollY),
        },
        topRight: {
          x: Math.round(rect.right + scrollX),
          y: Math.round(rect.top + scrollY),
        },
        bottomLeft: {
          x: Math.round(rect.left + scrollX),
          y: Math.round(rect.bottom + scrollY),
        },
        bottomRight: {
          x: Math.round(rect.right + scrollX),
          y: Math.round(rect.bottom + scrollY),
        },
        center: {
          x: Math.round(rect.left + rect.width / 2 + scrollX),
          y: Math.round(rect.top + rect.height / 2 + scrollY),
        },
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      nodeData.viewport = {
        scrollX: Math.round(scrollX),
        scrollY: Math.round(scrollY),
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).attributes) {
      const attributeNames = (node as Element).getAttributeNames?.() || [];
      for (const name of attributeNames) {
        //@ts-ignore
        nodeData.attributes[name] = node.getAttribute(name);
      }
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const isInteractive = isInteractiveElement(node as HTMLElement);
      const isVisible = isElementVisible(node as HTMLElement);
      const isTop = isTopElement(node as HTMLElement);

      nodeData.isInteractive = isInteractive;
      nodeData.isVisible = isVisible;
      nodeData.isTopElement = isTop;

      if (isInteractive && isVisible && isTop) {
        nodeData.highlightIndex = highlightIndex++;
        if (doHighlightElements) {
          if (focusHighlightIndex >= 0) {
            if (focusHighlightIndex === nodeData.highlightIndex) {
              highlightElement(
                node as HTMLElement,
                nodeData.highlightIndex,
                parentIframe,
              );
            }
          } else {
            highlightElement(
              node as HTMLElement,
              nodeData.highlightIndex,
              parentIframe,
            );
          }
        }
      }
    }

    if ((node as Element).shadowRoot) {
      nodeData.shadowRoot = true;
    }

    // Handle shadow DOM
    if ((node as Element).shadowRoot) {
      const shadowChildren = Array.from(
        (node as Element).shadowRoot!.childNodes,
      ).map((child) => buildDomTree(child as Element, parentIframe));
      // @ts-ignore
      nodeData.children.push(...shadowChildren);
    }

    // Handle iframes
    if ((node as Element).tagName === "IFRAME") {
      try {
        const iframeDoc =
          (node as HTMLIFrameElement).contentDocument ||
          (node as HTMLIFrameElement).contentWindow?.document;

        if (iframeDoc) {
          const iframeChildren = Array.from(iframeDoc.body.childNodes).map(
            (child) =>
              buildDomTree(child as Element, node as HTMLIFrameElement),
          );
          //@ts-ignore
          nodeData.children.push(...iframeChildren);
        }
      } catch (e) {
        console.warn("Unable to access iframe:", node);
      }
    } else {
      const children = Array.from(node.childNodes).map((child) =>
        buildDomTree(child as Element, parentIframe),
      );
      //@ts-ignore
      nodeData.children.push(...children);
    }

    return nodeData;
  }

  return buildDomTree(document.body);
};

export default getDomRepresentation;

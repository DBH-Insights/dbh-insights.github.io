// vim25 SOAP querying: RetrievePropertiesEx over a ContainerView of one object type.
//
// The biggest gotcha in vim25 responses: elements of a top-level array property are
// named after the property's declared *type*, not its field name
// (config.hardware.device comes back as <VirtualDevice xsi:type="VirtualDisk">),
// while arrays nested inside a data object repeat the field name (<childSnapshotList>).
// ManagedObject.array() returns the element children, so callers never depend on
// those names and filter on xsiType() instead.

const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

function childElement(el, name) {
  for (const c of el.children) if (c.localName === name) return c;
  return null;
}

function childElements(el, name) {
  return [...el.children].filter((c) => c.localName === name);
}

/** Text at a slash-separated child path, or null when any step is missing. Empty text is null too. */
function textAt(el, path) {
  let node = el;
  for (const part of path.split("/")) {
    if (!node) return null;
    node = childElement(node, part);
  }
  const text = node?.textContent;
  return text ? text : null;
}

function numberAt(el, path) {
  const text = textAt(el, path);
  if (text === null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function boolAt(el, path) {
  const text = textAt(el, path);
  return text === "true" ? true : text === "false" ? false : null;
}

/** The concrete type of a polymorphic element, without any namespace prefix. */
function xsiType(el) {
  const value = el?.getAttributeNS(XSI_NS, "type") || el?.getAttribute("xsi:type");
  return value ? value.replace(/^.*:/, "") : null;
}

/** One managed object plus the properties that were asked for. */
class ManagedObject {
  constructor(objectsEl) {
    const obj = childElement(objectsEl, "obj");
    this.moref = obj?.textContent ?? "";
    this.type = obj?.getAttribute("type") ?? "";
    this.props = new Map();
    for (const propSet of childElements(objectsEl, "propSet")) {
      const name = childElement(propSet, "name")?.textContent;
      const val = childElement(propSet, "val");
      if (name && val) this.props.set(name, val);
    }
  }

  /** Scalar property as text; null when absent or empty. */
  str(name) {
    const text = this.props.get(name)?.textContent;
    return text ? text : null;
  }

  num(name) {
    const text = this.str(name);
    if (text === null) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  bool(name) {
    const text = this.str(name);
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
    return null;
  }

  /** Members of an array-valued property. */
  array(name) {
    const val = this.props.get(name);
    return val ? [...val.children] : [];
  }
}

/**
 * Retrieve `props` for every managed object of `type` in the inventory.
 *
 * Follows the continuation token: silently accepting a truncated result would
 * under-report the inventory, which is the worst failure an inventory tool can have.
 */
async function retrieve(api, type, props) {
  const created = await api.soap(
    `<vim25:CreateContainerView><vim25:_this type="ViewManager">ViewManager</vim25:_this>` +
      `<vim25:container type="Folder">group-d1</vim25:container><vim25:type>${xmlEscape(type)}</vim25:type>` +
      `<vim25:recursive>true</vim25:recursive></vim25:CreateContainerView>`,
  );
  const view = firstByLocalName(created, "returnval")?.textContent;
  if (!view) throw new Error(`CreateContainerView for ${type} returned no view`);

  try {
    const pathSet = props.map((p) => `<vim25:pathSet>${xmlEscape(p)}</vim25:pathSet>`).join("");
    let page = await api.soap(
      `<vim25:RetrievePropertiesEx><vim25:_this type="PropertyCollector">propertyCollector</vim25:_this>` +
        `<vim25:specSet><vim25:propSet><vim25:type>${xmlEscape(type)}</vim25:type>${pathSet}</vim25:propSet>` +
        `<vim25:objectSet><vim25:obj type="ContainerView">${xmlEscape(view)}</vim25:obj><vim25:skip>true</vim25:skip>` +
        `<vim25:selectSet xsi:type="vim25:TraversalSpec"><vim25:name>view</vim25:name><vim25:type>ContainerView</vim25:type>` +
        `<vim25:path>view</vim25:path><vim25:skip>false</vim25:skip></vim25:selectSet></vim25:objectSet>` +
        `</vim25:specSet><vim25:options/></vim25:RetrievePropertiesEx>`,
    );

    const objects = [];
    for (;;) {
      const returnval = firstByLocalName(page, "returnval");
      if (!returnval) break; // no matching objects at all
      for (const el of childElements(returnval, "objects")) objects.push(new ManagedObject(el));
      const token = childElement(returnval, "token")?.textContent;
      if (!token) break;
      page = await api.soap(
        `<vim25:ContinueRetrievePropertiesEx><vim25:_this type="PropertyCollector">propertyCollector</vim25:_this>` +
          `<vim25:token>${xmlEscape(token)}</vim25:token></vim25:ContinueRetrievePropertiesEx>`,
      );
    }
    return objects;
  } finally {
    // Views live on the session until logout; drop this one either way.
    api
      .soap(`<vim25:DestroyView><vim25:_this type="ContainerView">${xmlEscape(view)}</vim25:_this></vim25:DestroyView>`)
      .catch(() => {});
  }
}

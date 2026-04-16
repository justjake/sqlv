import { createContext, useContext, type ReactNode } from "react"

export type IconStyle = "nerdfont" | "unicode"

export type IconName =
  | "database"
  | "expandClosed"
  | "expandOpen"
  | "folder"
  | "folderOpen"
  | "folderOpenEmpty"
  | "index"
  | "matview"
  | "placeholder"
  | "schema"
  | "table"
  | "trigger"
  | "view"

const IconStyleContext = createContext<IconStyle>("nerdfont")

const ICON_GLYPHS: Record<IconStyle, Record<IconName, string>> = {
  nerdfont: {
    database: "󰆼",
    expandClosed: "",
    expandOpen: "",
    folder: "",
    folderOpen: "",
    folderOpenEmpty: "󰉖",
    index: "⌗",
    matview: "󰈈",
    placeholder: "*",
    schema: "󰙅",
    table: "󰓫",
    trigger: "󰐕",
    view: "󰈈",
  },
  unicode: {
    database: "◍",
    expandClosed: "▸",
    expandOpen: "▾",
    folder: "□",
    folderOpen: "◫",
    folderOpenEmpty: "◫",
    index: "⌗",
    matview: "▤",
    placeholder: "•",
    schema: "◇",
    table: "▦",
    trigger: "⚑",
    view: "▤",
  },
}

export function IconProvider(props: { children: ReactNode; style: IconStyle }) {
  return <IconStyleContext value={props.style}>{props.children}</IconStyleContext>
}

export function useIconGlyph(name: IconName): string {
  return ICON_GLYPHS[useContext(IconStyleContext)][name]
}

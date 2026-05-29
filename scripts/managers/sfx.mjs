import { MODULE_ID } from "../constants.mjs"
import { slugify, renderHbs, tplPath, tKey } from "../utils.mjs"

export class SiegeSFXManager {
   static async resolvePath(path) {
      if (!path.includes("*")) return path

      const parts = path.split("/")
      const fileName = parts.pop()
      const dir = parts.join("/")
      const prefix = fileName.replace("*", "")

      try {
         const resp =
            await foundry.applications.apps.FilePicker.implementation.browse(
               "data",
               dir,
            )
         const matches = resp.files.filter((f) =>
            f.split("/").pop().startsWith(prefix),
         )
         if (matches.length === 0) return path
         return matches[Math.floor(Math.random() * matches.length)]
      } catch (err) {
         console.error("Siege SFX | Could not resolve wildcard path:", err)
         return path
      }
   }

   static async play(actor, key) {
      const rawPath = actor.getFlag(MODULE_ID, `sfx.${key}`)
      if (!rawPath) return

      const path = await this.resolvePath(rawPath)

      if (game.modules.get("socketlib")?.active && globalThis.socket) {
         globalThis.socket.executeForEveryone("playSFX", path)
      } else {
         foundry.audio.AudioHelper.play({ src: path, volume: 0.8 }, true)
      }
   }

   static async buildTabUI(app, html) {
      const tab = html.find(".tab.sfx")
      const siege = app.document
      const sfx = siege.getFlag(MODULE_ID, "sfx") || {}
      const ammoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || []
      const loadName = tKey("ActionTemplates.Load.Name")
      const actions = siege.items.filter(
         (i) => i.type === "action" && i.name !== loadName && i.name !== "Loading",
      )

      const rows = []
      for (const t of ammoTypes) {
         const key = `load-${slugify(t.slug || t.name)}`
         rows.push({
            key,
            label: tKey("SFX.LoadPrefix", { name: t.name }),
            value: sfx[key] || "",
         })
      }
      for (const a of actions) {
         const key = `action-${a.id}`
         rows.push({
            key,
            label: tKey("SFX.ActionPrefix", { name: a.name }),
            value: sfx[key] || "",
         })
      }

      const htmlContent = await renderHbs(tplPath("sheet/sfx-tab.hbs"), {
         rows,
         globalHeader: tKey("SFX.Header"),
      })
      tab.html(htmlContent)

      tab.find(".sfx-input").on("change", async (e) => {
         const key = $(e.currentTarget).data("key")
         await siege.setFlag(MODULE_ID, `sfx.${key}`, $(e.currentTarget).val())
      })

      tab.find(".play-sfx").on("click", (e) => {
         this.play(siege, $(e.currentTarget).data("key"))
      })

      tab.find(".file-picker").on("click", (e) => {
         new foundry.applications.apps.FilePicker.implementation({
            type: "audio",
            callback: async (path) => {
               const key = $(e.currentTarget).data("target")
               await siege.setFlag(MODULE_ID, `sfx.${key}`, path)
               html.find(`.sfx-input[data-key="${key}"]`).val(path)
            },
         }).browse()
      })
   }
}

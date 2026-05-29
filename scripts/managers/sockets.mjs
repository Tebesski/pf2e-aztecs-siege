import { MODULE_ID, DEFAULT_AMMO_IMG } from "../constants.mjs"
import { slugify, tKey } from "../utils.mjs"
import { SiegeSFXManager } from "./sfx.mjs"
import { AmmunitionManager } from "./ammunition.mjs"

export class SiegeSocketManager {
   static initHooks() {
      Hooks.once("socketlib.ready", () => this.onSocketlibReady())
   }

   static onSocketlibReady() {
      const socket = socketlib.registerModule(MODULE_ID)

      socket.register("playSFX", async (path) => {
         const resolvedPath = await SiegeSFXManager.resolvePath(path)
         foundry.audio.AudioHelper.play(
            { src: resolvedPath, volume: 0.8 },
            true,
         )
      })

      socket.register("executeSiegeLoad", async (...args) =>
         this._executeSiegeLoad(...args),
      )

      globalThis.socket = socket
   }

   static async _executeSiegeLoad(
      siegeUuid,
      choice,
      extracts,
      crewmanUuid,
      ammoProcured,
      flagTakeAdjacent,
   ) {
      const siege = await fromUuid(siegeUuid)
      const crewman = await fromUuid(crewmanUuid)
      if (!siege || !crewman) return

      const ammoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || []
      const tInfo = ammoTypes.find(
         (t) => t.slug === choice.slug || slugify(t.name) === choice.slug,
      )

      if (flagTakeAdjacent) {
         for (const ex of extracts) {
            const item = await fromUuid(ex.uuid)
            if (!item) continue
            const newQty = item.system.quantity - ex.take
            if (newQty <= 0) await item.delete()
            else await item.update({ "system.quantity": newQty })
         }
      }

      const existingAmmo = siege.items.find(
         (i) =>
            AmmunitionManager.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === choice.slug,
      )

      if (existingAmmo) {
         await existingAmmo.update({
            "system.quantity": existingAmmo.system.quantity + ammoProcured,
         })
      } else {
         const sourceItem = await this._findOrFetchSource(choice.slug)
         if (sourceItem) {
            const itemData = sourceItem.toObject()
            itemData.system.quantity = ammoProcured
            delete itemData._id
            delete itemData.ownership
            await siege.createEmbeddedDocuments("Item", [itemData])
         } else {
            await siege.createEmbeddedDocuments("Item", [
               {
                  name: tInfo.name,
                  type: "consumable",
                  img: DEFAULT_AMMO_IMG,
                  system: {
                     category: "ammo",
                     slug: choice.slug,
                     quantity: ammoProcured,
                  },
               },
            ])
         }
      }

      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.AmmoLoaded", {
            crewman: crewman.name,
            qty: ammoProcured,
            name: tInfo.name,
            siege: siege.name,
         }),
      })
      SiegeSFXManager.play(siege, `load-${choice.slug}`)
   }

   static async _findOrFetchSource(slug) {
      const direct = game.items.find(
         (i) =>
            AmmunitionManager.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === slug,
      )
      if (direct) return direct

      for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
         const index =
            pack.index.length > 0
               ? pack.index
               : await pack.getIndex({ fields: ["system.slug"] })
         const entry = index.find(
            (e) => (e.system?.slug || slugify(e.name)) === slug,
         )
         if (entry) return pack.getDocument(entry._id)
      }
      return null
   }
}

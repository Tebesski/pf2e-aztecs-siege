import { tKey } from "../../utils.mjs"
import { staticMethods } from "./helpers.mjs"

class SocketItemMixin {

   static async _applyItemMod(siege, action, data, context = {}) {
      if (action === "create")
         await siege.createEmbeddedDocuments("Item", data, context)
      else if (action === "update")
         await siege.updateEmbeddedDocuments("Item", data, context)
      else if (action === "delete")
         await siege.deleteEmbeddedDocuments("Item", data, context)
   }



   static _isSyntheticTokenActor(actor) {
      return !!(
         actor?.isToken ||
         actor?.token?.parent?.documentName === "Scene" ||
         (globalThis.Scene && actor?.token?.parent instanceof Scene)
      )
   }


   static async modifySiegeItem(siegeUuid, action, data, context = {}) {
      const siege = await fromUuid(siegeUuid)
      const shouldRouteToGM =
         !game.user.isGM &&
         globalThis.siegeSocket &&
         (!siege?.isOwner || this._isSyntheticTokenActor(siege))
      if (siege && !shouldRouteToGM) {
         await this._applyItemMod(siege, action, data, context)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "modifySiegeItem",
            siegeUuid,
            action,
            data,
            context,
         )
      } else {
         ui.notifications.error(tKey("Notifications.SocketlibRequired"))
      }
   }



   static async confirmConsequence(payload = {}) {
      if (game.user.isGM) return this._confirmConsequence(payload)
      if (globalThis.siegeSocket)
         return globalThis.siegeSocket.executeAsGM(
            "confirmConsequence",
            payload,
         )
      ui.notifications.error(tKey("Notifications.SocketlibRequired"))
      return false
   }



   static async _confirmConsequence(payload = {}) {
      const escape = (value) =>
         foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")
      const targetList = Array.isArray(payload.targets)
         ? payload.targets.map((name) => `<li>${escape(name)}</li>`).join("")
         : ""
      return foundry.applications.api.DialogV2.confirm({
         classes: ["siege-v2-dialog"],
         window: {
            title: tKey("Consequences.ConfirmTitle"),
         },
         content: `<p>${tKey("Consequences.ConfirmPrompt", {
            action: escape(payload.actionName || ""),
            consequence: escape(payload.consequenceLabel || ""),
            actor: escape(payload.actorName || ""),
         })}</p><ul>${targetList}</ul>`,
         yes: {
            label: tKey("Buttons.Confirm"),
            icon: "fa-solid fa-check",
         },
         no: {
            label: tKey("Buttons.Cancel"),
            icon: "fa-solid fa-times",
         },
         rejectClose: false,
      }).catch(() => false)
   }
}

export const socketItemMethods = staticMethods(SocketItemMixin)

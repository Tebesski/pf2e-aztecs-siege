import { MODULE_ID } from "../../constants.mjs"
import { getCrewActors, isEnterableVehicle, isSiege, tKey } from "../../utils.mjs"
import { SiegeCrewManager } from "../crew.mjs"
import { staticMethods } from "./helpers.mjs"

class TokenCrewTargetingMixin {

   static _targetKey(token) {
      return `${game.user?.id || ""}:${token?.document?.uuid || token?.id || ""}`
   }



   static _targetContextUser(context = {}) {
      const user = context.user
      if (!user) return game.user
      if (typeof user === "string") return game.users?.get(user) || null
      return user
   }



   static _shouldPromptCrewTarget(token, context = {}) {
      if (!game.user || context.siegeBypassCrewTargeting) return false
      if (context.groupSelection === true) return false
      const targetUser = this._targetContextUser(context)
      if (targetUser && targetUser !== game.user) return false
      const actor = token?.document?.actor
      if (actor?.type !== "vehicle") return false
      if (!actor.getFlag(MODULE_ID, "allowCrewTargeting")) return false
      if (!isSiege(actor) && !isEnterableVehicle(actor)) return false
      const key = this._targetKey(token)
      return !!key && !this._crewTargetPrompting.has(key)
   }



   static async _handleCrewTargetPrompt(vehicleToken, context = {}) {
      const vehicle = vehicleToken?.document?.actor
      if (!vehicle?.getFlag?.(MODULE_ID, "allowCrewTargeting")) return
      const key = this._targetKey(vehicleToken)
      if (!key || this._crewTargetPrompting.has(key)) return

      this._crewTargetPrompting.add(key)
      try {
         const sections = this._targetableCrewSections(vehicle)
         const mode = await this._promptVehicleTargetMode(vehicle)
         if (mode === "vehicle") return
         if (mode !== "crew") {
            this._replaceUserTargets([vehicleToken], [])
            return
         }

         const choices = await this._promptCrewTarget(sections)
         if (!choices?.length) {
            this._replaceUserTargets([vehicleToken], [])
            return
         }
         this._replaceUserTargets(
            [vehicleToken],
            choices.map((choice) => choice.token),
         )
      } finally {
         this._crewTargetPrompting.delete(key)
      }
   }



   static _replaceUserTargets(removeTokens = [], addTokens = []) {
      const remove = new Set(removeTokens.filter(Boolean).map((token) => this._targetTokenKey(token)))
      const additions = addTokens.map((token) => this._resolveLiveToken(token)).filter(Boolean)
      for (const token of additions) this._allowCrewTarget(token)
      const finalTargets = new Set(
         Array.from(game.user?.targets || []).filter(
            (token) => !remove.has(this._targetTokenKey(token)),
         ),
      )
      for (const token of additions) {
         if (token) finalTargets.add(token)
      }
      this._forceUserTargets(finalTargets)
   }



   static _forceUserTargets(targets) {
      const wanted = new Set(Array.from(targets || []).filter(Boolean))
      const current = Array.from(game.user?.targets || [])
      const ids = Array.from(wanted)
         .map((token) => token?.id || token?.document?.id)
         .filter(Boolean)
      const layerTokens = ids.map((id) => canvas?.tokens?.get?.(id) || null)
      const wantedKeys = new Set(
         Array.from(wanted)
            .map((token) => this._targetTokenKey(token))
            .filter(Boolean),
      )

      try {
         canvas?.tokens?.setTargets?.(ids, { mode: "replace" })
      } catch (_err) {}

      try {
         if (layerTokens.every(Boolean)) game.user?._onUpdateTokenTargets?.(ids)
      } catch (_err) {}

      for (const token of current) {
         if (!wantedKeys.has(this._targetTokenKey(token)))
            this._updateUserTarget(token, false)
      }
      for (const token of wanted) this._updateUserTarget(token, true)

      game.user?.broadcastActivity?.({ targets: ids })
   }



   static _updateUserTarget(token, targeted) {
      if (!token || !game.user) return
      if (typeof token._updateTarget === "function") {
         token._updateTarget(targeted, game.user)
      } else if (targeted) {
         game.user.targets?.add?.(token)
      } else {
         game.user.targets?.delete?.(token)
      }
      token.renderFlags?.set?.({ refreshTarget: true })
      if (targeted) this._refreshCrewTargetIndicator(token)
      if (token.document) ui.combat?.refreshTargetDisplay?.(token.document)
   }



   static _refreshCrewTargetIndicator(token) {
      if (!token) return
      try {
         token._refreshTarget?.()
      } catch (_err) {}
      for (const part of [token.targetArrows, token.targetPips]) {
         if (!part) continue
         if (part.visible !== undefined) part.visible = true
         if (part.renderable !== undefined) part.renderable = true
         if (part.alpha !== undefined) part.alpha = 1
         if (part.zIndex !== undefined) part.zIndex = 9999
      }
   }



   static _resolveLiveToken(token) {
      if (!token) return null
      const id = token.id || token.document?.id
      const uuid = token.document?.uuid || token.uuid
      const layerToken = id ? canvas?.tokens?.get?.(id) : null
      if (layerToken) return layerToken
      return (
         canvas?.tokens?.placeables?.find(
            (candidate) =>
               candidate?.id === id ||
               candidate?.document?.id === id ||
               candidate?.document?.uuid === uuid,
         ) ||
         (token?.setTarget || token?._updateTarget ? token : null)
      )
   }



   static _targetTokenKey(token) {
      return token?.document?.uuid || token?.uuid || token?.id || token?.document?.id || ""
   }



   static _targetableCrewSections(vehicle) {
      const positions = (vehicle.getFlag(MODULE_ID, "crew") || []).filter(
         (position) => position?.title && position.canBeTargeted !== false,
      )
      if (positions.length === 0) return []

      const byPosition = new Map(
         positions.map((position) => [position.title, { position, entries: [] }]),
      )
      for (const actor of getCrewActors(vehicle)) {
         const position = this._crewPositionForVehicle(actor, vehicle)
         const section = byPosition.get(position)
         if (!section) continue
         const token = this._crewTokenForActor(actor)
         if (!token) continue
         section.entries.push({ actor, token })
      }

      return positions
         .map((position) => byPosition.get(position.title))
         .filter((section) => section.entries.length > 0)
         .map((section) => ({
            ...section,
            entries: section.entries.sort((a, b) =>
               String(a.actor?.name || "").localeCompare(String(b.actor?.name || "")),
            ),
         }))
   }



   static _crewPositionForVehicle(actor, vehicle) {
      const effect = actor?.itemTypes?.effect?.find(
         (item) =>
            item.getFlag(MODULE_ID, "siegeId") === vehicle.id &&
            item.getFlag(MODULE_ID, "position"),
      )
      return effect?.getFlag(MODULE_ID, "position") || null
   }



   static _crewTokenForActor(actor) {
      const tokens = []
      const add = (token) => {
         if (!token?.setTarget) return
         if (tokens.some((existing) => existing.document?.uuid === token.document?.uuid))
            return
         tokens.push(token)
      }

      for (const token of actor?.getActiveTokens?.() || []) add(token)
      for (const token of canvas?.tokens?.placeables || []) {
         if (token.actor?.id === actor?.id || token.actor?.uuid === actor?.uuid)
            add(token)
      }
      return tokens.find((token) => token.document?.parent?.id === canvas?.scene?.id) || tokens[0] || null
   }



   static async _promptVehicleTargetMode(vehicle) {
      return foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog", "siege-crew-target-mode-dialog"],
         window: {
            title: tKey("Targeting.VehicleTargetTitle", { name: vehicle.name }),
         },
         content: "",
         buttons: [
            {
               action: "vehicle",
               label: tKey("Targeting.TargetVehicle"),
               default: true,
               callback: () => "vehicle",
            },
            {
               action: "crew",
               label: tKey("Targeting.TargetCrewmember"),
               callback: () => "crew",
            },
            {
               action: "cancel",
               label: tKey("Buttons.Cancel"),
               callback: () => "cancel",
            },
         ],
      }).catch(() => null)
   }



   static async _promptCrewTarget(sections) {
      if (sections.length === 0) {
         await foundry.applications.api.DialogV2.wait({
            classes: ["siege-v2-dialog", "siege-crew-target-dialog"],
            window: { title: tKey("Targeting.CrewTargetTitle") },
            content: `<p class="siege-crew-target-empty">${tKey("Targeting.NoTargetableCrew")}</p>`,
            buttons: [
               {
                  action: "cancel",
                  label: tKey("Buttons.Cancel"),
                  default: true,
                  callback: () => null,
               },
            ],
         }).catch(() => null)
         return null
      }

      const formId = `siege-crew-target-${foundry.utils.randomID()}`
      const content = `<div id="${formId}" class="siege-crew-target-dialog">
         <p>${tKey("Targeting.CrewTargetPrompt")}</p>
         ${sections.map((section) => `
            <fieldset>
               <legend>${this._escape(section.position.title)}</legend>
               ${section.entries.map((entry) => {
                  return `<label class="siege-crew-target-option">
                     <input type="checkbox" name="crewTarget" value="${this._escape(entry.token.document.uuid)}">
                     <span>${this._escape(entry.actor?.name || "")}</span>
                  </label>`
               }).join("")}
            </fieldset>`).join("")}
      </div>`

      const selectedUuids = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog", "siege-crew-target-dialog"],
         window: { title: tKey("Targeting.CrewTargetTitle") },
         position: { width: 420 },
         content,
         buttons: [
            {
               action: "target",
               label: tKey("Buttons.Confirm"),
               default: true,
               callback: (event, button, dialog) =>
                  this._selectedCrewTargetUuids(event, button, dialog, formId),
            },
            {
               action: "cancel",
               label: tKey("Buttons.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      if (!selectedUuids?.length) return []

      const selected = new Set(selectedUuids)
      const entries = []
      for (const section of sections) {
         for (const entry of section.entries) {
            if (selected.has(entry.token.document.uuid)) entries.push(entry)
         }
      }
      return entries
   }



   static _selectedCrewTargetUuids(event, button, dialog, formId) {
      const buttonForm = button?.form || null
      const form =
         (buttonForm?.id === formId ? buttonForm : null) ||
         buttonForm?.querySelector?.(`[id="${formId}"]`) ||
         dialog?.element?.querySelector?.(`[id="${formId}"]`) ||
         event?.currentTarget
            ?.closest?.(".application")
            ?.querySelector?.(`[id="${formId}"]`) ||
         document.getElementById(formId)
      const selected = Array.from(
         form?.querySelectorAll?.('input[name="crewTarget"]:checked') || [],
      ).map((input) => input.value)
      return selected
   }



   static _escape(value) {
      return foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")
   }



   static _deleteGroundStashActor(actor) {
      this._deletingGroundStashes = this._deletingGroundStashes || new Set()
      if (this._deletingGroundStashes.has(actor.id)) return
      this._deletingGroundStashes.add(actor.id)
      ;(async () => {
         for (const scene of game.scenes || []) {
            const ids = scene.tokens
               .filter((token) => token.actorId === actor.id)
               .map((token) => token.id)
            if (ids.length > 0) await scene.deleteEmbeddedDocuments("Token", ids)
         }
         await actor.delete()
      })().finally(() => this._deletingGroundStashes.delete(actor.id))
   }



   static async _handleStashDropToActor(targetActor, data) {
      try {
         const { vehicleId, itemId } = data.siegeStashMove
         if (!targetActor) return

         if (targetActor.id === vehicleId) return
         const { SiegeSocketManager } = await import("../sockets.mjs")
         await SiegeSocketManager.moveStashItem(
            vehicleId,
            itemId,
            targetActor.uuid,
            game.user.id,
         )
      } catch {
      }
   }



   static async _handleStashDropToCanvas(data) {
      try {
         const { vehicleId, itemId } = data.siegeStashMove
         const x = data.x
         const y = data.y
         const token = canvas?.tokens?.placeables?.find((t) => {
            const b = t.bounds
            return b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
         })
         if (!token?.actor) {
            const { SiegeSocketManager } = await import("../sockets.mjs")
            await SiegeSocketManager.dropStashItemToGround(
               vehicleId,
               itemId,
               canvas.scene.id,
               x,
               y,
               game.user.id,
            )
            return
         }
         const { SiegeSocketManager } = await import("../sockets.mjs")
         await SiegeSocketManager.moveStashItem(
            vehicleId,
            itemId,
            token.actor.uuid,
            game.user.id,
         )
      } catch {
      }
   }
}

export const tokenCrewTargetingMethods = staticMethods(TokenCrewTargetingMixin)

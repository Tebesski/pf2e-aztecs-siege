import { MODULE_ID } from "../constants.mjs"
import { isSiege, tKey } from "../utils.mjs"
import { SiegeMacros } from "../macros/index.mjs"
import { SiegeCrewManager } from "./crew.mjs"

export class SiegeTokenManager {
   static initHooks() {
      Hooks.once("setup", () => this.onSetup())
   }

   static onSetup() {
      const TokenClass = CONFIG.Token.objectClass || Token

      const originalCanView = TokenClass.prototype._canView
      TokenClass.prototype._canView = function (user, ...args) {
         if (isSiege(this.document?.actor)) return true
         if (originalCanView) return originalCanView.call(this, user, ...args)
         return this.document.testUserPermission(user, "OBSERVER")
      }

      const originalCanConfigure = TokenClass.prototype._canConfigure
      TokenClass.prototype._canConfigure = function (user, ...args) {
         if (isSiege(this.document?.actor)) return true
         if (originalCanConfigure)
            return originalCanConfigure.call(this, user, ...args)
         return user.isGM
      }

      const originalClickLeft2 = TokenClass.prototype._onClickLeft2
      TokenClass.prototype._onClickLeft2 = function (event) {
         const actor = this.document?.actor
         if (isSiege(actor) && !game.user.isGM) {
            const isMountable =
               actor.getFlag(MODULE_ID, "mountableByPCs") !== false
            if (!isMountable) {
               ui.notifications.warn(tKey("Notifications.CannotBeMountedByPCs"))
               return
            }

            const crewman =
               canvas.tokens.controlled[0]?.actor || game.user.character
            if (!crewman) {
               ui.notifications.warn(
                  tKey("Notifications.SelectCharacterTokenFirst"),
               )
               return
            }

            const effect = crewman.itemTypes.effect.find(
               (e) => e.getFlag(MODULE_ID, "siegeId") === actor.id,
            )
            if (effect) SiegeMacros.actionMacro(crewman)
            else SiegeMacros.mountMacro(crewman, actor)
            return
         }
         if (originalClickLeft2) return originalClickLeft2.call(this, event)
      }

      const originalClickRight2 = TokenClass.prototype._onClickRight2
      TokenClass.prototype._onClickRight2 = async function (event) {
         const actor = this.document?.actor
         if (isSiege(actor) && !game.user.isGM) {
            const crewman =
               canvas.tokens.controlled[0]?.actor || game.user.character
            if (crewman) {
               const effect = crewman.itemTypes.effect.find(
                  (e) => e.getFlag(MODULE_ID, "siegeId") === actor.id,
               )
               if (effect) {
                  await SiegeCrewManager.dismountCrewman(crewman, actor)
                  ui.notifications.info(
                     tKey("Notifications.CrewmanDismounted", {
                        crewman: crewman.name,
                        siege: actor.name,
                     }),
                  )
               }
            }
            return
         }
         if (originalClickRight2) return originalClickRight2.call(this, event)
      }
   }
}

import { MODULE_ID, DC_BY_LEVEL } from "../constants.mjs"
import {
   slugify,
   clampLevel,
   isSiege,
   ensureSiegeRoll,
   tKey,
} from "../utils.mjs"

export async function repairMacro(crewmanActor = null, siegeActor = null) {
   let crewman = crewmanActor
   let siege = siegeActor

   if (!crewman || !siege) {
      const controlled = canvas.tokens.controlled
      const targets = Array.from(game.user.targets)

      if (controlled.length !== 1 || targets.length !== 1)
         return ui.notifications.warn(
            tKey("Notifications.SelectOneCrewmanOneSiege"),
         )

      crewman = controlled[0].actor
      siege = targets[0].actor
   }

   if (!isSiege(siege))
      return ui.notifications.warn(tKey("Notifications.MustBeSiegeWeapon"))

   if (!crewman.skills.crafting)
      return ui.notifications.warn(tKey("Notifications.MissingCraftingSkill"))

   const siegeLevel = clampLevel(siege.system.details.level?.value)
   const autoDC =
      siege.getFlag(MODULE_ID, "disableDC") || DC_BY_LEVEL[siegeLevel]

   const options = ["action:repair", ...ensureSiegeRoll(siege)]

   await crewman.skills.crafting.roll({
      dc: { value: autoDC },
      extraRollOptions: options,
   })
}

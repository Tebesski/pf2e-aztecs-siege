import { mountMacro } from "./mount.mjs"
import { actionMacro } from "./action.mjs"
import { repairMacro } from "./repair.mjs"
import { delegateWeightMacro } from "./delegate.mjs"

export class SiegeMacros {
   static mountMacro = mountMacro
   static actionMacro = actionMacro
   static repairMacro = repairMacro
   static delegateWeightMacro = delegateWeightMacro
}

export { mountMacro, actionMacro, repairMacro, delegateWeightMacro }

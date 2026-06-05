import { mountMacro } from "./mount.mjs"
import { actionMacro } from "./action.mjs"
import { repairMacro } from "./repair.mjs"
import { delegateWeightMacro } from "./delegate.mjs"
import { takeLeadershipMacro, delegateLeadershipMacro } from "./leadership.mjs"
import { haulCreatureMacro } from "./haul-creature.mjs"
import { enterVehicleMacro } from "./enter.mjs"

export class SiegeMacros {
   static mountMacro = mountMacro
   static actionMacro = actionMacro
   static repairMacro = repairMacro
   static delegateWeightMacro = delegateWeightMacro
   static takeLeadershipMacro = takeLeadershipMacro
   static delegateLeadershipMacro = delegateLeadershipMacro
   static haulCreatureMacro = haulCreatureMacro
   static enterVehicleMacro = enterVehicleMacro
}

export {
   mountMacro,
   actionMacro,
   repairMacro,
   delegateWeightMacro,
   takeLeadershipMacro,
   delegateLeadershipMacro,
   haulCreatureMacro,
   enterVehicleMacro,
}

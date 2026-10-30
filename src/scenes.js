// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). The fields
// are strings, so a scene variable fits too (`{{triggerEvent.data.work_package}}`).
//
//   - `create_work_package`: create a work package in a project, of a type,
//     with an optional due date ("check the smoke detectors" every month,
//     "call the plumber" from a button);
//   - `read_today`: the work packages due today and the overdue ones as a
//     sentence, for a message or a voice announcement in the morning.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async create_work_package(hub, { fields = {} }) {
    return hub.createWorkPackage(fields);
  },

  async read_today(hub, { fields = {} }) {
    return hub.today(fields);
  },
};

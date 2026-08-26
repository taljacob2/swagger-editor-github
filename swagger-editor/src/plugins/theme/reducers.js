import { EDITOR_SET_THEME_MODE, EDITOR_SET_SYSTEM_PREFERS_DARK } from './actions.js';

const reducers = {
  [EDITOR_SET_THEME_MODE]: (state, action) => {
    return state.set('themeMode', action.payload);
  },
  [EDITOR_SET_SYSTEM_PREFERS_DARK]: (state, action) => {
    return state.set('systemPrefersDark', action.payload);
  },
};

export default reducers;

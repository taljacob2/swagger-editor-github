import { EDITOR_SET_THEME_MODE } from './actions.js';

const reducers = {
  [EDITOR_SET_THEME_MODE]: (state, action) => {
    return state.set('themeMode', action.payload);
  },
};

export default reducers;

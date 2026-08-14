import { setContent as setContentWrap } from './extensions/editor-textarea/wrap-actions.js';
import afterLoad from './after-load.js';
import TabBar from './components/TabBar/TabBar.jsx';

const WorkspaceTabsPlugin = () => {
  return {
    afterLoad,
    statePlugins: {
      editor: {
        wrapActions: {
          setContent: setContentWrap,
        },
      },
    },
    components: {
      WorkspaceTabsBar: TabBar,
    },
  };
};

export default WorkspaceTabsPlugin;

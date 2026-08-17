import PropTypes from 'prop-types';
import { SplitPane } from 'react-collapse-pane';

import useIsMobile from '../../hooks/useIsMobile.js';

const Layout = ({ getComponent, useSwaggerEditorReactModal, useSplashScreen }) => {
  const EditorPane = getComponent('EditorPane', true);
  const EditorPreviewPane = getComponent('EditorPreviewPane', true);
  const TopBar = getComponent('TopBar', true);
  const WorkspaceTabsBar = getComponent('WorkspaceTabsBar', true);
  const Container = getComponent('Container'); // accessed from swagger-ui`
  const Dropzone = getComponent('Dropzone', true);
  const SplashScreen = getComponent('SplashScreen', true);
  const ref = useSwaggerEditorReactModal();
  const [canDisplaySplashScreen, canDisplayLayout] = useSplashScreen();
  const isMobile = useIsMobile();

  return (
    <div className="swagger-editor__layout" ref={ref}>
      <SplashScreen isOpen={canDisplaySplashScreen} />
      {canDisplayLayout && (
        <>
          <TopBar />
          {WorkspaceTabsBar && <WorkspaceTabsBar />}
          <Container className="container">
            <Dropzone>
              {/* On mobile, stack the editor above the preview (touch-draggable
                  resizer, per react-collapse-pane) instead of the side-by-side
                  split -- two ~180px-wide panes on a phone are unusable for
                  either code or docs. initialSizes are relative weights, not
                  pixels: the library scales them proportionally to the actual
                  container size, so [3, 2] just means "editor gets more than
                  an even split" without needing to know the real viewport
                  height up front. */}
              <SplitPane
                split={isMobile ? 'horizontal' : 'vertical'}
                initialSizes={isMobile ? [3, 2] : undefined}
              >
                <EditorPane />
                <EditorPreviewPane />
              </SplitPane>
            </Dropzone>
          </Container>
        </>
      )}
    </div>
  );
};

Layout.propTypes = {
  getComponent: PropTypes.func.isRequired,
  useSwaggerEditorReactModal: PropTypes.func.isRequired,
  useSplashScreen: PropTypes.func.isRequired,
};

export default Layout;

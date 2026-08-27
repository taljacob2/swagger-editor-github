import React from 'react';
import PropTypes from 'prop-types';
import ReactModal from 'react-modal';

const Modal = ({
  isOpen = false,
  contentLabel = null,
  aria = {},
  children = null,
  onRequestClose,
  editorSelectors = null,
}) => {
  // react-modal renders its portal as a sibling of the app root (appended
  // to document.body), outside the DOM subtree the `theme` plugin scopes
  // with data-theme -- so this class carries the same dark-mode CSS
  // variable overrides directly onto the portal itself (see the
  // .ReactModalPortal.swagger-editor__theme-dark rule in _globals.scss).
  const isDark = editorSelectors?.selectResolvedTheme?.() === 'dark';

  return (
    <ReactModal
      isOpen={isOpen}
      contentLabel={contentLabel}
      aria={aria}
      closeTimeoutMS={200}
      className="ReactModalDefault"
      overlayClassName="ReactModalOverlay"
      portalClassName={isDark ? 'ReactModalPortal swagger-editor__theme-dark' : 'ReactModalPortal'}
      onRequestClose={onRequestClose}
      // react-modal only wires up its own Esc-key listener and overlay
      // click-to-close when it has a request-close handler to call --
      // without this, Esc silently does nothing.
      shouldCloseOnEsc={Boolean(onRequestClose)}
      shouldCloseOnOverlayClick={Boolean(onRequestClose)}
    >
      <div className="modal-content">{children}</div>
    </ReactModal>
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool,
  contentLabel: PropTypes.string,
  aria: PropTypes.shape({ labelledby: PropTypes.string, describedby: PropTypes.string }),
  children: PropTypes.node,
  onRequestClose: PropTypes.func,
  editorSelectors: PropTypes.shape({
    selectResolvedTheme: PropTypes.func,
  }),
};

export default Modal;

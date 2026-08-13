import GitHubMenu from './components/GitHubMenu.jsx';

const GitHubConnectionPlugin = () => ({
  components: {
    TopBarGitHubMenu: GitHubMenu,
  },
});

export default GitHubConnectionPlugin;

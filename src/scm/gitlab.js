"use strict";

class Gitlab {
  constructor(baseUrl, user, token) {
    this.baseUrl = baseUrl;
    this.user = user;
    this.namesToIds = {
      repos: {},
      groups: {}
    };
    this.accessToken = token;
    this.namespaces = [user];
    debugger;
  }

  get name() {
    return 'gitlab';
  }

  get canUseGist() {
    return false;
  }


  commitFiles(repo, branch, parent, files, deleteFiles, comment) {
    return new Promise((resolve, reject) => {
      let data = files.reduce((hash, f) => {
        hash[f.name] = f.content;
        return hash;
      }, {});
      data.message = comment;
      if (deleteFiles && deleteFiles.length > 0) {
        data.files = deleteFiles;
      }
      if (branch) {
        data.branch = branch;
      }
      if (parent) {
        data.parents = parent;
      }
      $.ajax({
        url: `${this.baseUrl}/repositories/${repo}/src`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        contentType: 'application/x-www-form-urlencoded',
        method: 'POST',
        crossDomain: true,
        traditional: true,
        data: data,
      })
        .then(resolve)
        .fail(reject);
    });
  }

  push(code) {
    const changed = $('.diff-file:checked').toArray().map(elem => elem.value);
    const files = changed.filter(f => code.gas[f]).map(f => {
      return {name: f.replace(/\.gs$/, context.config.filetype), content: code.gas[f]}
    });
    const deleteFiles = changed.filter(f => !code.gas[f]);
    const comment = $('#commit-comment').val();

    this.commitFiles(context.repo.fullName, context.branch, null, files, deleteFiles, comment)
      .then(() => {
        showAlert(`Successfully push to ${context.branch} of ${context.repo.fullName}`);
      })
      .catch((err) => {
        showAlert('Failed to push', LEVEL_ERROR);
      });
  }

  getAllBranches() {
    context.repo.id = context.repo.id || this.namesToIds.repos[context.repo.fullName];
    return getAllItems(Promise.resolve(
      {
        token: this.accessToken,
        items: [],
        url: `${this.baseUrl}/projects/${context.repo.id}/repository/branches?access_token=${this.accessToken}`
      }),
      this.followPaginate,
      'gitlab'
    );
  }

  getCode() {
    return new Promise((resolve, reject) => {
      return $.getJSON(
        `${this.baseUrl}/projects/${context.repo.id}/repository/tree?ref=${context.branch}&access_token=${this.accessToken}`, {}
      )
        .then(resolve)
        .fail(reject)
    })
        .then(response => {
          const re = new RegExp(`(\\${context.config.filetype}|\\.html${context.config.manifestEnabled ? '|^appsscript.json' : ''})$`);
          const promises = response.filter((tree) => {
            return tree.type === 'blob' && re.test(tree.path);
          })
            .map(tree => {
              var xx = `${this.baseUrl}/projects/${context.repo.id}/repository/files/${tree.path}?ref=${context.branch}&access_token=${this.accessToken}`;
              return new Promise((resolve, reject) => {
                $.getJSON(xx, {})
                  .then((content) => {
                    resolve({file: tree.path, content: decodeURIComponent(escape(atob(content.content)))});
                  })
                  .fail(reject)
              });
            });
          return Promise.all(promises);
        });
  }

  getNamespaces() {
    let testUrl = `${this.baseUrl}/groups?access_token=${this.accessToken}`;
    return getAllItems(Promise.resolve(
      {
        token: this.accessToken,
        items: [],
        url: testUrl
      }),
      this.followPaginate,
      'gitlab'
    )
      .then(groups => {
        this.namespaces = [this.user].concat(groups.map(group => group.name));
        return this.namespaces;
      })
      .catch((err) => {
        showAlert('Failed to get user info.', LEVEL_ERROR);
      });
  }

  getRepos() { // Named Projects in gitlab
    return getAllItems(Promise.resolve(
      {
        token: this.accessToken,
        items: [],
        url: `${this.baseUrl}/users/${this.user}/projects?access_token=${this.accessToken}`
      }),
      this.followPaginate,
      'gitlab'
    )
      .then(response => {
        this.namesToIds.repos = response.reduce((obj, item) => (obj[item.name] = item.id, obj), {});
        const repos = Object.keys(this.namesToIds.repos);
        //if current bind still existed, use it
        const repo = context.bindRepo[context.id];
        if (repo && $.inArray(repo.fullName, repos) >= 0) {
          context.repo = repo;
        }
        return repos;
      });
  }

  createRepo() {
    const owner = $('#new-repo-owner').val();
    const name = $('#new-repo-name').val();
    const desc = $('#new-repo-desc').val();
    const visibility = ($('#new-repo-type').val() !== 'public') ? 'private' : 'public';
    const payload = {
      name: name,
      description: desc,
      visibility: visibility
    };
    if (!name || name === '') return;
    return new Promise((resolve, reject) => {
      return $.ajax({
        url: `${this.baseUrl}/projects`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        method: 'POST',
        crossDomain: true,
        dataType: 'json',
        contentType: 'application/json',
        data: JSON.stringify(payload)
      })
        .then(resolve)
        .fail(reject);
    })
      .then(response => {
        const repo = {
          fullName: response.name,
          id: response.id
        };
        context.repo = repo;
        Object.assign(context.bindRepo, {[context.id]: repo});
        if (context.bindBranch[context.id]) {
          delete context.bindBranch[context.id];
        }
        chrome.storage.sync.set({bindRepo: context.bindRepo});
        return response.name;
      })
      .catch((err) => {
        throw new Error('Failed to create new repository.');
      });
  }

  createBranch() {
    const branch = $('#new-branch-name').val();
    if (!branch || branch === '') return;
    return new Promise((resolve, reject) => {
      return $.getJSON(
        `${this.baseUrl}/repositories/${context.repo.fullName}/refs/branches/${context.branch}`,
        {access_token: this.accessToken}
      );
    })
      .then(res => {
        const parent = res.target ? res.target.hash : null;
        return this.commitFiles(context.repo.fullName, branch, parent, [], null, `create new branch ${branch}`);
      })
      .then(() => {
        context.branch = branch;
        Object.assign(context.bindBranch, {[context.id]: branch});
        chrome.storage.sync.set({bindBranch: context.bindBranch});
        return branch;
      })
      .catch(err => {
        throw new Error('Failed to create new branch.');
      });
  }

  followPaginate(data) {
    return new Promise((resolve, reject) => {
      $.getJSON(data.url)
        .then(response => {
          data.items = data.items.concat(response);
          const link = response.next;
          let url = null;
          if (link) {
            url = link;
          }
          resolve({items: data.items, url: url});
        })
        .fail(reject);
    })
  }
}

// function sendNotification(body, tag = 'filebox') {
//     let enabled = Notification.permission === 'granted';
//     if (!enabled) {
//         return;
//     }
//     new Notification("Filebox", {
//         body: body,
//         tag: tag || 'filebox',
//         icon: '/assets/icon.png',
//     });
// }

async function updateFolderStats(folders) {
  if (folders.length === 0) {
    return;
  }
  let resp = await fetch(`/api/children-count`, {
    method: "POST",
    body: JSON.stringify(folders),
  });
  let stat = await resp.json();
  stat.forEach((stat) => {
    let statElem = document.getElementById(`stat-${stat.hash}`);
    if (statElem) {
      statElem.innerHTML = `${stat.count} items • ${statElem.innerHTML}`;
    }
  });
}

async function downloadFolderAsZip(folder) {
  const { tree, _ } = await buildChildrenTree(folder);
  let totalSize = caculateTreeSize(tree);
  let folderData = {
    name: folder.name,
    size: totalSize,
    type: "folder",
    hash: folder.hash,
  };
  prependQueueElem(folderData, false);
  showSnack(`Zipping ${folder.name}...`, COLOR_BLUE, `info`);
  const zip = await zipFolderRecursive(
    tree,
    folder.hash,
    new JSZip(),
    0,
    totalSize
  );
  let content = await zip.generateAsync({ type: "blob" });
  let a = document.createElement("a");
  a.href = window.URL.createObjectURL(content);
  a.download = `${folder.name}.zip`;
  a.click();
}

async function deleteFolderPermanently(folder) {
  let ok = confirm(
    `Are you sure you want to delete folder "${folder.name}" permanently?`
  );
  if (!ok) return;
  const { tree, _ } = await buildChildrenTree(folder);
  let treeSize = caculateTreeSize(tree);
  async function deleteFilesRecursively(tree) {
    await fetch(`/api/metadata`, {
      method: "DELETE",
      body: JSON.stringify(folder),
    });
    let folderElem = document.getElementById(`file-${folder.hash}`);
    if (folderElem) {
      folderElem.remove();
    }
    tree.forEach(async (file) => {
      if (file.type === "folder") {
        await deleteFilesRecursively(file.children);
      }
      await fetch(`/api/metadata`, {
        method: "DELETE",
        body: JSON.stringify(file),
      });
    });
  }
  await deleteFilesRecursively(tree);
  updateSpaceUsage(-treeSize);
}

function handleTrashFileMenuClick(file) {
  let fileOptionPanel = document.createElement("div");
  fileOptionPanel.className = "file_menu";
  let title = document.createElement("div");
  title.className = "title";
  let fileNameElem = document.createElement("p");
  fileNameElem.innerHTML = file.name;
  title.appendChild(fileNameElem);
  let close = document.createElement("span");
  close.className = `material-symbols-rounded`;
  close.innerHTML = `chevron_right`;
  close.addEventListener("click", () => {
    hideRightNav();
  });
  title.appendChild(close);
  fileOptionPanel.appendChild(title);
  let restore = document.createElement("div");
  restore.className = "file_menu_option";
  restore.innerHTML = `<p>Restore</p><span class="material-symbols-rounded">replay</span>`;
  restore.addEventListener("click", async () => {
    delete file.deleted;
    let ok = await checkFileParentExists(file);
    if (!ok && file.parent !== undefined) {
      showSnack(
        `Parent not found. Restoring to root`,
        COLOR_ORANGE,
        "warning"
      );
      file.parent = null;
    }
    await fetch(`/api/metadata`, {
      method: "PATCH",
      body: JSON.stringify(file),
    });
    showSnack(`Restored ${file.name}`, COLOR_GREEN, "success");
    document.getElementById(`file-${file.hash}`).remove();
    delete trashFilesGL[file.hash];
    close.click();
  });
  let deleteButton = document.createElement("div");
  deleteButton.className = "file_menu_option";
  deleteButton.innerHTML = `<p>Delete Permanently</p><span class="material-symbols-rounded">delete_forever</span>`;
  deleteButton.addEventListener("click", () => {
    fetch(`/api/metadata`, {
      method: "DELETE",
      body: JSON.stringify(file),
    }).then(() => {
      showSnack(`Permanently deleted ${file.name}`, COLOR_RED, "info");
      document.getElementById(`file-${file.hash}`).remove();
      if (!file.shared) {
        updateSpaceUsage(-file.size);
      }
      close.click();
      if (trashFilesGL.length === 0) {
        renderOriginalNav();
      }
    });
  });
  fileOptionPanel.appendChild(restore);
  fileOptionPanel.appendChild(deleteButton);
  renderInRightNav(fileOptionPanel);
}

function handleFileMenuClick(file) {
  let fileOptionPanel = document.createElement("div");
  fileOptionPanel.className = "file_menu";

  // Title
  let title = document.createElement("div");
  title.className = "title";
  let fileNameElem = document.createElement("p");
  fileNameElem.innerHTML = file.name;
  title.appendChild(fileNameElem);
  let close = document.createElement("span");
  close.className = `material-symbols-rounded`;
  close.innerHTML = `chevron_right`;
  close.addEventListener("click", () => {
    hideRightNav();
  });
  title.appendChild(close);
  fileOptionPanel.appendChild(title);

  // Access
  let visibilityOption = document.createElement("div");
  visibilityOption.className = "file_menu_option";
  let visibility = file.access === "private" ? "visibility_off" : "visibility";
  visibilityOption.innerHTML = `<p>Access</p><span class="material-symbols-rounded">${visibility}</span>`;
  visibilityOption.addEventListener("click", () => {
    if (file.access === "private") {
      file.access = "public";
      visibilityOption.innerHTML = `<p>Access</p><span class="material-symbols-rounded">visibility</span>`;
      file.size > 1024 * 1024 * 4000 ? (embed.style.opacity = 0.3) : (embed.style.opacity = 1);
      showSnack("Access changed to public", COLOR_GREEN, "info");
    } else {
      file.access = "private";
      visibilityOption.innerHTML = `<p>Access</p><span class="material-symbols-rounded">visibility_off</span>`;
      share.style.opacity = 0.3;
      embed.style.opacity = 0.3;
      showSnack("Access changed to private", COLOR_ORANGE, "info");
    }
    fetch(`/api/file/access`, {
      method: "PATCH",
      body: JSON.stringify({ hash: file.hash, access: file.access }),
    });
  });
  if (file.type !== "folder") {
    fileOptionPanel.appendChild(visibilityOption);
  }

  // Bookmark
  let bookmarkMode = file.pinned ? "remove" : "add";
  let bookmarkOption = document.createElement("div");
  bookmarkOption.className = "file_menu_option";
  bookmarkOption.innerHTML = `<p>Pin</p><span class="material-symbols-rounded">${bookmarkMode}</span>`;
  bookmarkOption.addEventListener("click", () => {
    if (file.pinned) {
      fetch(`/api/bookmark/${file.hash}`, { method: "DELETE" }).then(() => {
        showSnack(`Unpinned successfully`, COLOR_ORANGE, "info");
        let card = document.getElementById(`card-${file.hash}`);
        if (card) {
          card.remove();
        }
        delete file.pinned;
        bookmarkOption.innerHTML = `<p>Bookmark</p><span class="material-symbols-rounded">add</span>`;
      });
    } else {
      fetch(`/api/bookmark/${file.hash}`, { method: "POST" }).then(() => {
        showSnack(`Pinned successfully`, COLOR_GREEN, "success");
        let pins = document.querySelector(".pinned_files");
        if (pins) {
          pins.appendChild(newFileElem(file));
        }
        file.pinned = true;
        bookmarkOption.innerHTML = `<p>Bookmark</p><span class="material-symbols-rounded">remove</span>`;
      });
    }
  });
  fileOptionPanel.appendChild(bookmarkOption);

  // Share
  let send = document.createElement("div");
  send.className = "file_menu_option";
  send.innerHTML = `<p>Send</p><span class="material-symbols-rounded">send</span>`;
  if (file.type !== "folder") {
    send.addEventListener("click", () => {
      if (file.owner) {
        showSnack("Can't send a file that you don't own", COLOR_ORANGE, "info");
        return;
      }
      renderFileSenderModal(file);
    });
    fileOptionPanel.appendChild(send);
  }

  // Rename
  let rename = document.createElement("div");
  rename.className = "file_menu_option";
  rename.innerHTML = `<p>Rename</p><span class="material-symbols-rounded">edit</span>`;
  rename.addEventListener("click", () => {
    fileNameElem.contentEditable = true;
    fileNameElem.spellcheck = false;
    fileNameElem.focus();
    fileNameElem.addEventListener("blur", (e) => {
      fileNameElem.contentEditable = false;
      if (file.name === fileNameElem.innerText) {
        return;
      }
      let extPattern = /\.[0-9a-z]+$/i;
      let oldext = extPattern.exec(file.name);
      oldext = oldext ? oldext[0] : "";
      let newext = extPattern.exec(fileNameElem.innerText);
      newext = newext ? newext[0] : "";
      fileNameElem.contentEditable = false;
      if (oldext !== newext) {
        e.target.innerHTML = file.name;
        showSnack("File extension cannot be changed", COLOR_ORANGE, "warning");
        return;
      }
      fetch(`/api/rename`, {
        method: "POST",
        body: JSON.stringify({ hash: file.hash, name: fileNameElem.innerText }),
      }).then((res) => {
        if (res.status === 200) {
          file.name = fileNameElem.innerText;
          document.querySelector(`#filename-${file.hash}`).innerHTML =
            file.name;
          showSnack(`File renamed to ${file.name}`, COLOR_GREEN, "success");
        }
      });
    });
  });

  // Download
  let downloadButton = document.createElement("div");
  downloadButton.className = "file_menu_option";
  downloadButton.innerHTML = `<p>Download</p><span class="material-symbols-rounded">download</span>`;
  downloadButton.addEventListener("click", () => {
    close.click();
    prependQueueElem(file, false);
    if (file.shared === true) {
      downloadShared(file, (percentage) => {
        progressHandlerById(file.hash, percentage);
      });
      return;
    }
    download(file, (percentage) => {
      progressHandlerById(file.hash, percentage);
    });
  });

  // Share
  let share = document.createElement("div");
  share.className = "file_menu_option";
  share.innerHTML = `<p>Share Link</p><span class="material-symbols-rounded">link</span>`;
  share.addEventListener("click", () => {
    if (file.access === "private") {
      showSnack(`Make file public to share via link`, COLOR_ORANGE, "warning");
    } else {
      window.navigator.clipboard
        .writeText(`${window.location.origin}/shared/${file.hash}`)
        .then(() => {
          showSnack(`Copied to clipboard`, COLOR_GREEN, "success");
        });
    }
  });

  // Embed
  let embed = document.createElement("div");
  embed.className = "file_menu_option";
  embed.innerHTML = `<p>Embed</p><span class="material-symbols-rounded">code</span>`;
  embed.addEventListener("click", () => {
    if (file.access === "private") {
      showSnack(`Make file public to embed`, COLOR_ORANGE, "warning");
    } else if (file.size > 1024 * 1024 * 4000) {
      showSnack(`File is too large to embed`, COLOR_RED, "error");
    } else {
      window.navigator.clipboard
        .writeText(`${window.location.origin}/embed/${file.hash}`)
        .then(() => {
          showSnack(`Copied to clipboard`, COLOR_GREEN, "success");
        });
    }
  });

  // Move
  let move = document.createElement("div");
  move.className = "file_menu_option";
  move.innerHTML = `<p>Move</p><span class="material-symbols-rounded">arrow_forward</span>`;
  move.addEventListener("click", () => {
    close.click();
    renderAuxNav(fileMover(file));
    isFileMovingGL = true;
    browseButton.click();
  });
  if (file.type !== "folder") {
    fileOptionPanel.appendChild(rename);
    fileOptionPanel.appendChild(downloadButton);
    if (file.access === "private") {
      share.style.opacity = 0.3;
    }
    fileOptionPanel.appendChild(share);
    if (file.access === "private" || file.size > 1024 * 1024 * 4000) {
      embed.style.opacity = 0.3;
    }
    fileOptionPanel.appendChild(embed);
    fileOptionPanel.appendChild(move);
  }

  // Download as zip
  let downloadZip = document.createElement("div");
  downloadZip.className = "file_menu_option";
  downloadZip.innerHTML = `<p>Download as Zip</p><span class="material-symbols-rounded">archive</span>`;
  downloadZip.addEventListener("click", () => {
    downloadFolderAsZip(file);
  });
  if (file.type === "folder") {
    fileOptionPanel.appendChild(downloadZip);
  }

  // Trash
  let trashButton = document.createElement("div");
  trashButton.className = "file_menu_option";
  if (file.type === "folder") {
    trashButton.innerHTML = `<p>Delete Permanently</p><span class="material-symbols-rounded">delete_forever</span>`;
  } else {
    trashButton.innerHTML = `<p>Trash</p><span class="material-symbols-rounded">delete_forever</span>`;
  }
  trashButton.addEventListener("click", async () => {
    if (file.type === "folder") {
      deleteFolderPermanently(file).then(() => {
        showSnack(
          `Deleted folder "${file.name}" permanently`,
          COLOR_RED,
          "warning"
        );
        close.click();
      });
    } else {
      file.deleted = true;
      fetch(`/api/metadata`, {
        method: "PATCH",
        body: JSON.stringify(file),
      }).then(() => {
        showSnack(`Moved to trash ${file.name}`, COLOR_RED, "warning");
        document.getElementById(`file-${file.hash}`).remove();
        close.click();
      });
    }
  });
  fileOptionPanel.appendChild(trashButton);

  // Access Control
  if (file.recipients && file.recipients.length > 0) {
    let p = document.createElement("p");
    p.innerText = "Block Access";
    p.style.fontSize = "14px";
    p.style.color = "white";
    p.style.width = "100%";
    p.style.padding = "10px 20px";
    p.style.backgroundColor = "rgba(242, 58, 58, 0.5)";
    fileOptionPanel.appendChild(p);
    file.recipients.forEach((recipient) => {
      let recipientElem = document.createElement("div");
      recipientElem.className = "file_menu_option";
      recipientElem.innerHTML = `<p>${recipient} </p><span class="material-symbols-rounded">block</span>`;
      recipientElem.addEventListener("click", () => {
        file.recipients = file.recipients.filter((r) => r !== recipient);
        fetch(`/api/metadata`, {
          method: "PATCH",
          body: JSON.stringify(file),
        }).then(() => {
          showSnack(`Blocked access for ${recipient}`, COLOR_ORANGE, "warning");
          recipientElem.remove();
        });
      });
      fileOptionPanel.appendChild(recipientElem);
    });
  }

  renderInRightNav(fileOptionPanel);
}

async function handleFolderClick(folder) {
  openedFolderGL = folder;
  let parentOf = folder.parent
    ? `${folder.parent}/${folder.name}`
    : folder.name;
  const resp = await fetch(`/api/query`, {
    method: "POST",
    body: JSON.stringify({ parent: parentOf }),
  })
  const data = await resp.json()
  MAIN.innerHTML = "";
  MAIN.appendChild(buildPrompt(folder));
  let fragment = parentOf ? `~/${parentOf}` : "home";
  document.querySelector(".fragment").innerText = fragment;
  if (!data) return;
  let folders = [];
  let files = [];
  data.forEach((file) => {
    file.type === "folder" ? folders.push(file) : files.push(file);
  });
  let list = document.createElement("ul");
  MAIN.appendChild(list);
  folders.concat(files).forEach((file) => {
    list.appendChild(newFileElem(file));
  });
  updateFolderStats(folders);
}

function newFileElem(file, trashed = false) {
  let li = document.createElement("li");
  li.id = `file-${file.hash}`;
  let fileIcon = document.createElement("div");
  fileIcon.style.color = file.color || "#ccc";
  let pickerElem = document.createElement("input");
  pickerElem.type = "color";
  pickerElem.style.display = "none";
  pickerElem.value = file.color || "#ccc";
  pickerElem.addEventListener("change", () => {
    file.color = pickerElem.value;
    fetch(`/api/metadata`, {
      method: "PATCH",
      body: JSON.stringify(file),
    }).then(() => {
      fileIcon.style.color = file.color;
      showSnack(`Folder color changed successfully`, COLOR_GREEN, "success");
    });
  });
  fileIcon.appendChild(pickerElem);
  fileIcon.className = "file_icon";
  setIconByMime(file.mime, fileIcon);
  fileIcon.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (file.type === "folder") {
      pickerElem.click();
      return;
    }
    if (!document.querySelector(".multi_select_options")) {
      let multiSelectOptions = document.createElement("div");
      multiSelectOptions.className = "multi_select_options";
      let zipButton = document.createElement("button");
      zipButton.innerHTML =
        '<span class="material-symbols-rounded">archive</span>';
      zipButton.addEventListener("click", () => {
        let zip = new JSZip();
        let totalSize = 0;
        multiSelectBucketGL.forEach((file) => {
          totalSize += parseInt(file.size);
        });
        let randomZipId = randId();
        let zipData = {
          name: `filebox-download-${randomZipId}.zip`,
          mime: "application/zip",
          size: totalSize,
          hash: randomZipId,
        };
        prependQueueElem(zipData);
        queueButton.click();
        let promises = [];
        let completed = 0;
        multiSelectBucketGL.forEach((file) => {
          promises.push(
            fetchFileFromDrive(file, (cmp) => {
              completed += cmp;
              let percentage = Math.round((completed / totalSize) * 100);
              progressHandlerById(zipData.hash, percentage);
            }).then((blob) => {
              zip.file(file.name, new Blob([blob], { type: file.mime }));
            })
          );
        });
        Promise.all(promises).then(() => {
          zip.generateAsync({ type: "blob" }).then((content) => {
            let a = document.createElement("a");
            a.href = window.URL.createObjectURL(content);
            a.download = zipData.name;
            a.click();
          });
        });
      });
      let moveButton = document.createElement("button");
      moveButton.innerHTML =
        '<span class="material-symbols-rounded">arrow_forward</span>';
      moveButton.addEventListener("click", () => {
        isFileMovingGL = true;
        browseButton.click();
        let fileMover = document.createElement("div");
        fileMover.className = "file_mover";
        let cancelButton = document.createElement("button");
        cancelButton.innerHTML = "Cancel";
        cancelButton.addEventListener("click", () => {
          renderOriginalNav();
        });
        let selectButton = document.createElement("button");
        selectButton.innerHTML = "Select";
        selectButton.style.backgroundColor = "var(--color-blueish)";
        selectButton.addEventListener("click", () => {
          multiSelectBucketGL.forEach((file) => {
            delete file.deleted;
          });
          if (!openedFolderGL) {
            multiSelectBucketGL.forEach((file) => {
              delete file.parent;
            });
          } else {
            multiSelectBucketGL.forEach((file) => {
              if (openedFolderGL.parent) {
                file.parent = `${openedFolderGL.parent}/${openedFolderGL.name}`;
              } else {
                file.parent = openedFolderGL.name;
              }
            });
          }
          fetch(`/api/bulk`, {
            method: "PATCH",
            body: JSON.stringify(multiSelectBucketGL),
          }).then(() => {
            showSnack("Files Moved Successfully", COLOR_GREEN, "success");
            if (openedFolderGL) {
              handleFolderClick(openedFolderGL);
              renderOriginalNav();
            } else {
              isFileMovingGL = false;
              browseButton.click();
            }
          });
        });
        let p = document.createElement("p");
        p.innerHTML = "Select Move Destination";
        fileMover.appendChild(cancelButton);
        fileMover.appendChild(p);
        fileMover.appendChild(selectButton);
        renderAuxNav(fileMover);
      });
      let privateButton = document.createElement("button");
      privateButton.innerHTML =
        '<span class="material-symbols-rounded">visibility_off</span>';
      privateButton.addEventListener("click", () => {
        multiSelectBucketGL.forEach((file) => {
          file.access = "private";
        });
        fetch(`/api/bulk`, {
          method: "PATCH",
          body: JSON.stringify(multiSelectBucketGL),
        }).then(() => {
          showSnack(`Made selected files private`, COLOR_ORANGE, "info");
        });
      });
      let publicButton = document.createElement("button");
      publicButton.innerHTML =
        '<span class="material-symbols-rounded">visibility</span>';
      publicButton.addEventListener("click", () => {
        multiSelectBucketGL.forEach((file) => {
          file.access = "public";
        });
        fetch(`/api/bulk`, {
          method: "PATCH",
          body: JSON.stringify(multiSelectBucketGL),
        }).then(() => {
          showSnack(`Made selected files public`, COLOR_GREEN, "info");
        });
      });
      let deleteButton = document.createElement("button");
      deleteButton.innerHTML =
        '<span class="material-symbols-rounded">delete_forever</span>';
      deleteButton.style.backgroundColor = COLOR_DELETE_FOREVER;
      deleteButton.addEventListener("click", () => {
        let ok = confirm(
          `Do you really want to delete ${multiSelectBucketGL.length} file(s)?`
        );
        if (!ok) {
          return;
        }
        fetch(`/api/bulk`, {
          method: "DELETE",
          body: JSON.stringify(multiSelectBucketGL),
        }).then(() => {
          multiSelectBucketGL.forEach((file) => {
            document.getElementById(`file-${file.hash}`).remove();
          });
          multiSelectBucketGL = [];
          renderOriginalNav();
          showSnack(`Deleted selected files`, COLOR_RED, "info");
          document.getElementById("deselect-all").click();
        });
      });
      let selectCount = document.createElement("p");
      selectCount.style.marginRight = "auto";
      selectCount.id = "selection-count";
      multiSelectOptions.appendChild(selectCount);
      multiSelectOptions.appendChild(zipButton);
      multiSelectOptions.appendChild(moveButton);
      multiSelectOptions.appendChild(privateButton);
      multiSelectOptions.appendChild(publicButton);
      multiSelectOptions.appendChild(deleteButton);
      renderAuxNav(multiSelectOptions);
    }
    if (multiSelectBucketGL.length === 25) {
      showSnack(`Can't select more than 25 items`, COLOR_ORANGE, "warning");
      return;
    } else {
      li.style.backgroundColor = "rgba(255, 255, 255, 0.055)";
      let checkIcon = document.createElement("span");
      checkIcon.className = "material-symbols-rounded";
      checkIcon.innerHTML = "done";
      checkIcon.style.color = "rgb(30, 112, 30)";
      checkIcon.style.backgroundColor = "var(--color-blackish-hover)";
      checkIcon.style.borderRadius = "50%";
      checkIcon.style.padding = "5px";
      checkIcon.style.fontSize = "20px";
      fileIcon.innerHTML = "";
      fileIcon.appendChild(checkIcon);
      let index = multiSelectBucketGL.findIndex((f) => f.hash === file.hash);
      if (index === -1) {
        multiSelectBucketGL.push(file);
      } else {
        multiSelectBucketGL.splice(index, 1);
        li.style.backgroundColor = "transparent";
        setIconByMime(file.mime, fileIcon);
      }
      document.getElementById(
        "selection-count"
      ).innerHTML = `${multiSelectBucketGL.length} selected`;
      if (multiSelectBucketGL.length === 0) {
        renderOriginalNav();
      }
    }
  });
  let fileInfo = document.createElement("div");
  fileInfo.className = "info";
  let fileName = document.createElement("p");
  fileName.innerHTML = file.name;
  fileName.id = `filename-${file.hash}`;
  let fileSizeAndDate = document.createElement("p");
  fileSizeAndDate.style.fontSize = "11px";
  fileSizeAndDate.id = `stat-${file.hash}`;
  if (file.type === "folder") {
    fileSizeAndDate.innerHTML = `${formatDateString(file.date)}`;
  } else {
    fileSizeAndDate.innerHTML = `${handleSizeUnit(
      file.size
    )} • ${formatDateString(file.date)}`;
  }
  fileInfo.appendChild(fileName);
  fileInfo.appendChild(fileSizeAndDate);
  li.appendChild(fileIcon);
  li.appendChild(fileInfo);
  let menuOptionSpan = document.createElement("span");
  menuOptionSpan.className = "material-symbols-rounded";
  menuOptionSpan.innerHTML = "more_horiz";
  menuOptionSpan.style.fontSize = "18px";
  menuOptionSpan.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (trashed) {
      handleTrashFileMenuClick(file);
    } else {
      handleFileMenuClick(file);
    }
  });
  li.appendChild(menuOptionSpan);
  li.addEventListener("click", (ev) => {
    if (file.type === "folder") {
      handleFolderClick(file);
    } else if (fileName.contentEditable === "true") {
      ev.stopPropagation();
      return;
    } else {
      showFilePreview(file);
    }
  });
  li.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (fileContextMenuGL) {
      fileContextMenuGL.close();
    }
    new FileContextMenu(ev, file).show();
  });
  return li;
}

function buildPinnedContent(data) {
  let ul = document.createElement("ul");
  ul.className = "pinned_files";
  data.forEach((file) => {
    ul.appendChild(newFileElem(file));
  });
  let fileList = document.createElement("div");
  fileList.className = "file_list";
  fileList.appendChild(ul);
  return fileList;
}

function buildRecentContent(data) {
  let ul = document.createElement("ul");
  ul.className = "recent_files";
  data.forEach((file) => {
    if (file.parent !== "~shared") {
      ul.appendChild(newFileElem(file));
    }
  });
  let fileList = document.createElement("div");
  fileList.className = "file_list";
  fileList.appendChild(ul);
  return fileList;
}

function buildFileBrowser(data) {
  let ul = document.createElement("ul");
  ul.className = "all_files";
  data.forEach((file) => {
    ul.appendChild(newFileElem(file));
  });
  let fileList = document.createElement("div");
  fileList.className = "file_list";
  fileList.appendChild(ul);
  return fileList;
}

function buildPrompt(folder) {
  let prompt = document.createElement("div");
  prompt.className = "prompt";
  let fragment = document.createElement("p");
  fragment.className = "fragment";
  let div = document.createElement("div");
  let backButton = document.createElement("i");
  backButton.className = "material-symbols-rounded";
  backButton.innerHTML = "arrow_back";
  backButton.addEventListener("click", () => {
    if (!isFileMovingGL) {
      multiSelectBucketGL = [];
    }
    if (!folder.parent) {
      browseButton.click();
      return;
    }
    let fragments = folder.parent.split("/");
    handleFolderClick({
      name: fragments.pop(),
      parent: fragments.length >= 1 ? fragments.join("/") : null,
    });
  });
  let selectAll = document.createElement("i");
  selectAll.className = "material-symbols-rounded";
  selectAll.innerHTML = "select_all";
  selectAll.addEventListener("click", () => {
    let targets = [];
    let clickedTargets = [];
    let list = MAIN.children[1].children;
    Array.from(list).forEach((li) => {
      let icon = li.firstElementChild.firstElementChild;
      if (icon.innerHTML === "folder") {
        return;
      }
      icon.innerHTML === "done"
        ? clickedTargets.push(icon)
        : targets.push(icon);
    });
    targets.slice(0, 25 - clickedTargets.length).forEach((icon) => {
      icon.click();
    });
    if (targets.length > 0) {
      selectAll.style.display = "none";
      deselectAll.style.display = "block";
    }
  });
  let deselectAll = document.createElement("i");
  deselectAll.id = "deselect-all";
  deselectAll.className = "material-symbols-rounded";
  deselectAll.innerHTML = "deselect";
  deselectAll.style.display = "none";
  deselectAll.addEventListener("click", () => {
    let list = MAIN.children[1].children;
    Array.from(list).forEach((li) => {
      let icon = li.firstElementChild.firstElementChild;
      if (icon.innerHTML === "folder") {
        return;
      }
      icon.innerHTML === "done" ? icon.click() : null;
    });
    deselectAll.style.display = "none";
    selectAll.style.display = "block";
  });
  prompt.appendChild(backButton);
  div.appendChild(fragment);
  div.appendChild(selectAll);
  div.appendChild(deselectAll);
  prompt.appendChild(div);
  return prompt;
}

function updateToCompleted(hash) {
  let icon = document.querySelector(`#icon-${hash}`);
  icon.className = "fa-solid fa-check-circle";
  icon.style.color = "#279627";
}

let snackTimer = null;
function showSnack(text, color = COLOR_GREEN, type = "success") {
  let icons = {
    success: "done",
    error: "cancel",
    warning: "priority_high",
    info: "question_mark",
  };
  let snackbar = document.querySelector(".snackbar");
  snackbar.style.display = "flex";
  let content = document.createElement("div");
  content.className = "snack_content";
  content.style.backgroundColor = color;
  let icon = document.createElement("i");
  icon.className = "material-symbols-rounded";
  icon.style.marginRight = "10px";
  icon.innerHTML = icons[type];
  let p = document.createElement("p");
  p.innerHTML = text;
  let close = document.createElement("i");
  close.className = "material-symbols-rounded";
  close.style.marginLeft = "10px";
  close.innerHTML = "close";
  close.style.cursor = "pointer";
  close.style.backgroundColor = "transparent";
  close.addEventListener("click", () => {
    snackbar.style.display = "none";
  });
  snackbar.innerHTML = "";
  content.appendChild(icon);
  content.appendChild(p);
  content.appendChild(close);
  snackbar.appendChild(content);
  if (snackTimer) {
    clearTimeout(snackTimer);
  }
  snackTimer = setTimeout(() => {
    snackbar.style.display = "none";
  }, 3000);
}

function renderFilesByQuery(query) {
  sidebarOptionSwitch();
  if (previousOption) {
    previousOption.style.borderLeft = "5px solid transparent";
    previousOption.style.backgroundColor = "transparent";
    previousOption = null;
  }
  query["deleted?ne"] = true;
  fetch("/api/query", { method: "POST", body: JSON.stringify(query) })
    .then((response) => response.json())
    .then((data) => {
      MAIN.innerHTML = "";
      if (!data) {
        showSnack("No files found of this type", COLOR_ORANGE, "warning");
        return;
      }
      let fileList = document.createElement("div");
      fileList.className = "file_list";
      let ul = document.createElement("ul");
      ul.className = "all_files";
      data.forEach((file) => {
        ul.appendChild(newFileElem(file));
      });
      fileList.appendChild(ul);
      MAIN.appendChild(fileList);
    });
}

async function loadSharedFile(file, controller, loaderElem) {
  let size = file.size;
  const chunkSize = 1024 * 1024 * 4000;
  if (size < chunkSize) {
    let resp = await fetch(
      `/api/external/${userIdGL}/${file.owner}/${file.hash}/0`,
      { signal: controller.signal }
    );
    loaderElem.innerHTML = "100%";
    return await resp.blob();
  } else {
    let skips = 0;
    let progress = 0;
    if (size % chunkSize === 0) {
      skips = size / chunkSize;
    } else {
      skips = Math.floor(size / chunkSize) + 1;
    }
    let heads = Array.from(Array(skips).keys());
    let promises = [];
    heads.forEach((head) => {
      promises.push(
        fetch(`/api/external/${userIdGL}/${file.owner}/${file.hash}/${head}`)
          .then((resp) => {
            return resp.blob();
          })
          .then((blob) => {
            progress += blob.size;
            let percentage = Math.floor((progress / size) * 100);
            loaderElem.innerHTML = `${percentage}%`;
            return blob;
          })
      );
    });
    let blobs = await Promise.all(promises);
    return new Blob(blobs, { type: file.mime });
  }
}

// this will suck at large files
async function showFilePreview(file) {
  filePreviewModal.innerHTML = "";
  filePreviewModal.innerHTML = `
    <p><i>${file.name}</i> - <b><span style="color: ${COLOR_GREEN}" id='loader-amount'>0%</span></b></p>`;
  filePreviewModal.showModal();
  let loaderAmount = document.querySelector("#loader-amount");
  controller = new AbortController();
  let src;
  let embed = document.createElement("embed");
  if (file.shared) {
    let blob = await loadSharedFile(file, controller, loaderAmount);
    src = URL.createObjectURL(new Blob([blob], { type: file.mime }));
    loaderAmount.innerHTML = "100%";
  } else {
    let extRegex = /(?:\.([^.]+))?$/;
    let extension = extRegex.exec(file.name);
    if (extension && extension[1]) {
      extension = extension[1];
    } else {
      extension = "";
    }
    let filename;
    if (extension === "") {
      filename = file.hash;
    } else {
      filename = `${file.hash}.${extension}`;
    }
    let projectId = secretKeyGL.split("_")[0];
    let url = `https://drive.deta.sh/v1/${projectId}/filebox/files/download?name=${filename}`;
    const response = await fetch(url, {
      headers: { "X-Api-Key": secretKeyGL },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      embed.type = "application/json";
      src = URL.createObjectURL(await response.blob(), { type: "application/json" });
    } else {
      let progress = 0;
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        start(controller) {
          return pump();
          function pump() {
            return reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }
              controller.enqueue(value);
              progress += value.length;
              let percentage = Math.floor((progress / file.size) * 100);
              loaderAmount.innerHTML = `${percentage}%`;
              return pump();
            });
          }
        },
      });
      const rs = new Response(stream);
      const blob = await rs.blob();
      src = URL.createObjectURL(new Blob([blob], { type: file.mime }));
      embed.type = file.mime;
    }
  }
  filePreviewModal.innerHTML = "";
  embed.src = src;
  filePreviewModal.appendChild(embed);
}

function fileMover(file) {
  let fileMover = document.createElement("div");
  fileMover.className = "file_mover";
  let cancelButton = document.createElement("button");
  cancelButton.innerHTML = "Cancel";
  cancelButton.addEventListener("click", () => {
    renderOriginalNav();
  });
  let selectButton = document.createElement("button");
  selectButton.innerHTML = "Select";
  selectButton.style.backgroundColor = "var(--color-blueish)";
  selectButton.addEventListener("click", () => {
    if (!openedFolderGL) {
      delete file.parent;
    } else {
      if (openedFolderGL.parent) {
        file.parent = `${openedFolderGL.parent}/${openedFolderGL.name}`;
      } else {
        file.parent = openedFolderGL.name;
      }
    }
    fetch(`/api/metadata`, {
      method: "PATCH",
      body: JSON.stringify(file),
    }).then(() => {
      if (openedFolderGL) {
        if (document.querySelector(`#file-${file.hash}`)) {
          showSnack("File is already here", COLOR_ORANGE, "info");
          return;
        }
        showSnack("File Moved Successfully", COLOR_GREEN, "success");
        handleFolderClick(openedFolderGL);
        renderOriginalNav();
      } else {
        isFileMovingGL = false;
        browseButton.click();
      }
    });
  });
  let p = document.createElement("p");
  p.innerHTML = "Select Move Destination";
  fileMover.appendChild(cancelButton);
  fileMover.appendChild(p);
  fileMover.appendChild(selectButton);
  return fileMover;
}

function buildDynamicNavIcon() {
  let icon = document.createElement("span");
  icon.className = "material-symbols-rounded";
  icon.id = "dyn-nav-icon";
  if (window.innerWidth < 768) {
    icon.innerHTML = "menu";
    icon.style.color = "#ccc";
    icon.style.padding = "0px 10px";
    icon.addEventListener("click", () => {
      BLUR_LAYER.style.display = "block";
      NAV_LEFT.style.display = "flex";
    });
  } else {
    icon.innerHTML = "search";
    icon.style.color = "var(--color-blueish)";
    icon.style.padding = "0px";
    icon.style.paddingRight = "10px";
    icon.style.paddingLeft = "10px";
  }
  return icon;
}

function renderSearchResults(query) {
  fetch(`/api/query`, {
    method: "POST",
    body: JSON.stringify(query),
  })
    .then((response) => response.json())
    .then((data) => {
      let key = Object.keys(query)[0];
      let attr = key.replace("?contains", "");
      let value = query[key];
      MAIN.innerHTML = "";
      if (!data) {
        let p = document.createElement("p");
        let symbol = `<i class="fa-solid fa-circle-exclamation"></i> `;
        p.innerHTML = `${symbol} No results found for ${attr}: *${value}*`;
        p.style.backgroundColor = "#e44d27";
        MAIN.appendChild(p);
        return;
      }
      let absoluteResults = data.filter((file) => {
        if (file.name.startsWith(query)) {
          data.splice(data.indexOf(file), 1);
          return true;
        } else {
          return false;
        }
      });
      data = absoluteResults.concat(data);
      let p = document.createElement("p");
      p.innerHTML = `Search results for ${attr}: *${value}*`;
      p.style.backgroundColor = "#317840";
      MAIN.appendChild(p);
      let list = document.createElement("ul");
      MAIN.appendChild(list);
      data.forEach((file) => {
        list.appendChild(newFileElem(file));
      });
    });
}

function renderOriginalNav() {
  isFileMovingGL = false;
  openedFolderGL = null;
  multiSelectBucketGL = [];
  NAV_TOP.style.paddingLeft = "10px";
  NAV_TOP.style.paddingRight = "10px";
  let icon = buildDynamicNavIcon();
  let searched = false;
  let clearButton = document.createElement("button");
  clearButton.innerHTML =
    '<span class="material-symbols-rounded">clear_all</span>';
  clearButton.style.display = "none";
  clearButton.addEventListener("click", () => {
    clearButton.style.display = "none";
    if (searched) {
      currentOption().click();
    } else {
      inputBar.value = "";
    }
  });
  let inputBar = document.createElement("input");
  inputBar.type = "text";
  inputBar.placeholder = "Search in Drive";
  inputBar.spellcheck = false;
  inputBar.autocomplete = "on";
  let inputTimer = null;
  inputBar.addEventListener("input", (ev) => {
    if (inputTimer) {
      clearTimeout(inputTimer);
    }
    inputTimer = setTimeout(() => {
      if (ev.target.value.length > 0) {
        searched = true;
        clearButton.style.display = "flex";
        let matches = /:(.*?) (.*)/.exec(ev.target.value);
        if (matches) {
          let attr = matches[1];
          let contains = matches[2];
          renderSearchResults({ [`${attr}?contains`]: `${contains}` });
        } else {
          renderSearchResults({ "name?contains": `${ev.target.value}` });
        }
      }
    }, 500);
  });
  let newFolderButton = document.createElement("button");
  newFolderButton.innerHTML =
    '<span class="material-symbols-rounded">create_new_folder</span>';
  newFolderButton.addEventListener("click", () => {
    createFolder();
  });
  let newHiddenFolderInput = document.createElement("input");
  newHiddenFolderInput.type = "file";
  newHiddenFolderInput.multiple = true;
  newHiddenFolderInput.style.display = "none";
  newHiddenFolderInput.webkitdirectory = true;
  newHiddenFolderInput.addEventListener("change", (ev) => {
    let relativePaths = [];
    for (let i = 0; i < ev.target.files.length; i++) {
      relativePaths.push(ev.target.files[i].webkitRelativePath);
    }
    let uniqueFolders = [];
    for (let i = 0; i < relativePaths.length; i++) {
      let folderPath = relativePaths[i].split("/");
      folderPath.pop();
      folderPath = folderPath.join("/");
      if (!uniqueFolders.includes(folderPath)) {
        uniqueFolders.push(folderPath);
      }
    }
    let parents = [];
    uniqueFolders.forEach((folder) => {
      let folderPath = folder.split("/");
      let currentPath = "";
      folderPath.forEach((folder) => {
        currentPath += folder + "/";
        if (!parents.includes(currentPath)) {
          parents.push(currentPath);
        }
      });
    });
    let strippedParents = parents.map((parent) => {
      return parent.slice(0, -1);
    });
    strippedParents.forEach((parent) => {
      let relativePath;
      if (openedFolderGL) {
        if (openedFolderGL.parent) {
          relativePath = `${openedFolderGL.parent}/${openedFolderGL.name}`;
        } else {
          relativePath = openedFolderGL.name;
        }
      }
      let folderName;
      let folderPath = "";
      if (parent.includes("/")) {
        let parentParts = parent.split("/");
        folderName = parentParts.pop();
        folderPath = `${parentParts.join("/")}`;
      } else {
        folderName = parent;
      }
      if (relativePath && folderPath) {
        folderPath = `${relativePath}/${folderPath}`;
      } else if (relativePath) {
        folderPath = relativePath;
      }
      let body = {
        name: folderName,
        type: "folder",
        hash: randId(),
        date: new Date().toISOString(),
      };
      body.parent = folderPath ? folderPath : null;
      fetch(`/api/metadata`, { method: "POST", body: JSON.stringify(body) });
    });
    for (let i = 0; i < ev.target.files.length; i++) {
      let file = ev.target.files[i];
      let relativePath = ev.target.files[i].webkitRelativePath;
      let parentFragments = relativePath.split("/");
      parentFragments.pop();
      let parent = parentFragments.join("/");
      if (openedFolderGL) {
        if (openedFolderGL.parent) {
          parent = `${openedFolderGL.parent}/${openedFolderGL.name}/${parent}`;
        } else {
          parent = `${openedFolderGL.name}/${parent}`;
        }
      }
      let metadata = buildFileMetadata(file);
      metadata.parent = parent;
      prependQueueElem(metadata, true);
      upload(
        file,
        metadata,
        (percentage) => {
          progressHandlerById(metadata.hash, percentage);
        },
        false
      );
    }
  });
  let folderUploadButton = document.createElement("button");
  folderUploadButton.innerHTML =
    '<span class="material-symbols-rounded">drive_folder_upload</span>';
  folderUploadButton.addEventListener("click", () => {
    newHiddenFolderInput.click();
  });
  let newHiddenFileInput = document.createElement("input");
  newHiddenFileInput.type = "file";
  newHiddenFileInput.multiple = true;
  newHiddenFileInput.style.display = "none";
  let newFileButton = document.createElement("button");
  newFileButton.innerHTML =
    '<span class="material-symbols-rounded">upload_file</span>';
  newFileButton.addEventListener("click", () => {
    newHiddenFileInput.click();
  });
  newHiddenFileInput.addEventListener("change", (ev) => {
    queueButton.click();
    for (let i = 0; i < ev.target.files.length; i++) {
      let file = ev.target.files[i];
      let metadata = buildFileMetadata(file);
      prependQueueElem(metadata, true);
      upload(file, metadata, (percentage) => {
        progressHandlerById(metadata.hash, percentage);
      });
    }
  });
  NAV_TOP.innerHTML = "";
  NAV_TOP.appendChild(icon);
  NAV_TOP.appendChild(inputBar);
  NAV_TOP.appendChild(clearButton);
  NAV_TOP.appendChild(newFolderButton);
  NAV_TOP.appendChild(folderUploadButton);
  NAV_TOP.appendChild(newFileButton);
  NAV_TOP.appendChild(newHiddenFileInput);
  NAV_TOP.appendChild(newHiddenFolderInput);
}

function renderAuxNav(elem) {
  NAV_TOP.style.width = "100%";
  NAV_TOP.style.margin = "0";
  NAV_TOP.style.padding = "0";
  let wrapper = document.createElement("div");
  wrapper.className = "other";
  NAV_TOP.innerHTML = "";
  wrapper.appendChild(elem);
  NAV_TOP.appendChild(wrapper);
}

function renderFileSenderModal(file) {
  if (!userIdGL) {
    showSnack(
      "File sending is not available for this instance",
      COLOR_ORANGE,
      "info"
    );
    return;
  }
  let fileSender = document.createElement("div");
  fileSender.className = "file_sender";
  let filename = document.createElement("p");
  filename.innerHTML = file.name;
  let userIdField = document.createElement("input");
  userIdField.placeholder = "Type user instance id";
  userIdField.type = "text";
  userIdField.spellcheck = false;
  let buttons = document.createElement("div");
  let cancelButton = document.createElement("button");
  cancelButton.innerHTML = "Cancel";
  cancelButton.addEventListener("click", () => {
    hideRightNav();
  });
  let sendButton = document.createElement("button");
  sendButton.innerHTML = "Send";
  sendButton.style.backgroundColor = COLOR_GREEN;
  sendButton.addEventListener("click", () => {
    if (userIdField.value === userIdGL) {
      showSnack("You can't send a file to yourself", COLOR_ORANGE, "warning");
      return;
    }
    let fileClone = structuredClone(file);
    delete fileClone.recipients;
    delete fileClone.pinned;
    fileClone.owner = userIdGL;
    fileClone.shared = true;
    fileClone.parent = "~shared";
    fetch(`/api/push/${userIdField.value}`, {
      method: "POST",
      body: JSON.stringify(fileClone),
    }).then((resp) => {
      if (resp.status !== 207) {
        fileSender.style.display = "none";
        showSnack("Something went wrong. Please try again", COLOR_RED, "error");
        return;
      }
      if (file.recipients) {
        if (!file.recipients.includes(userIdField.value)) {
          file.recipients.push(userIdField.value);
        }
      } else {
        file.recipients = [userIdField.value];
      }
      fetch(`/api/metadata`, {
        method: "PATCH",
        body: JSON.stringify(file),
      }).then((resp) => {
        if (resp.status === 207) {
          showSnack(
            `File shared with ${userIdField.value}`,
            COLOR_GREEN,
            "success"
          );
          fileSender.style.display = "none";
        } else {
          showSnack(
            "Something went wrong. Please try again",
            COLOR_RED,
            "error"
          );
        }
      });
    });
  });
  buttons.appendChild(cancelButton);
  buttons.appendChild(sendButton);
  fileSender.appendChild(filename);
  fileSender.appendChild(userIdField);
  fileSender.appendChild(buttons);
  renderInRightNav(fileSender);
}

function renderGreetings() {
  let greetings = document.createElement("div");
  greetings.className = "greetings";
  let skip = document.createElement("div");
  skip.className = "skip";
  skip.innerHTML = "<p>skip</p>";
  skip.addEventListener("click", () => {
    localStorage.setItem("isGreeted", true);
    greetings.remove();
  });
  let innerOne = document.createElement("div");
  innerOne.className = "inner";
  innerOne.innerHTML = '<img src="../assets/app_icon.png" alt="icon">';
  let innerTwo = document.createElement("div");
  innerTwo.className = "inner";
  let h1 = document.createElement("h1");
  h1.innerHTML = "Welcome to Filebox";
  let p = document.createElement("p");
  p.innerHTML = `Let's upload your first file`;
  let dropSection = document.createElement("div");
  let dropSectionSpan = document.createElement("span");
  dropSectionSpan.innerHTML = "Drop your file here or click to select";
  dropSection.className = "drop";
  dropSection.appendChild(dropSectionSpan);
  let pseudoInput = document.createElement("input");
  pseudoInput.type = "file";
  pseudoInput.style.display = "none";
  pseudoInput.addEventListener("change", () => {
    dropSectionSpan.innerHTML = pseudoInput.files[0].name;
    uploadButton.disabled = false;
    uploadButton.style.opacity = "1";
  });
  dropSection.appendChild(pseudoInput);
  dropSection.addEventListener("click", () => {
    pseudoInput.click();
  });
  dropSection.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropSection.style.border = "2px dashed #cccccc8f";
  });
  dropSection.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropSection.style.border = "2px dashed var(--color-blackish-hover)";
  });
  dropSection.addEventListener("drop", (e) => {
    e.preventDefault();
    dropSection.style.border = "2px dashed var(--color-blackish-hover)";
    pseudoInput.files = e.dataTransfer.files;
    dropSectionSpan.innerHTML = pseudoInput.files[0].name;
    uploadButton.disabled = false;
    uploadButton.style.opacity = "1";
  });
  let uploadButton = document.createElement("button");
  uploadButton.innerHTML = "Upload";
  uploadButton.disabled = true;
  uploadButton.style.opacity = "0.5";
  uploadButton.addEventListener("click", () => {
    let file = pseudoInput.files[0];
    let metadata = buildFileMetadata(file);
    prependQueueElem(metadata, true);
    upload(file, metadata, (percentage) => {
      progressHandlerById(metadata.hash, percentage);
    });
    localStorage.setItem("isGreeted", true);
    skip.click();
  });
  innerTwo.appendChild(h1);
  innerTwo.appendChild(p);
  innerTwo.appendChild(dropSection);
  innerTwo.appendChild(uploadButton);
  greetings.appendChild(skip);
  greetings.appendChild(innerOne);
  greetings.appendChild(innerTwo);
  document.body.prepend(greetings);
}

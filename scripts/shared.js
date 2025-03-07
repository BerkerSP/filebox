let file = null;
let isTaskRunning = false;
let footer = document.querySelector("footer");
let fileSizeBar = document.querySelector("#size");
let progressBar = document.querySelector(".progress");
let percentage = document.querySelector("#percentage");
let fileNameElem = document.querySelector("#filename");
let downloadButton = document.querySelector("#download");

window.addEventListener("DOMContentLoaded", async () => {
  let hash = window.location.href.split("/").pop();
  let resp = await fetch(`/api/metadata/${hash}`);
  file = await resp.json();
  fileNameElem.innerHTML = file.name;
});

downloadButton.addEventListener("click", async () => {
  if (isTaskRunning) {
    return;
  }
  footer.style.display = "none";
  progressBar.style.width = "0%";
  isTaskRunning = true;
  footer.style.display = "block";
  percentage.innerHTML = `Downloaded 0.00%`;
  let size = file.size;
  let fileSizeMB = (size / (1024 * 1024)).toFixed(2);
  fileSizeBar.innerHTML = `0.00 / ${fileSizeMB} MB`;
  let name = file.name;
  const chunkSize = 1024 * 1024 * 4000;
  if (size < chunkSize) {
    const resp = await fetch(`/api/download/na/${file.hash}/0`);
    if (resp.status === 403) {
      alert(`File access denied by owner!`);
      window.location.reload();
    } else {
      let url = URL.createObjectURL(await resp.blob());
      let a = document.createElement("a");
      a.href = url;
      a.download = name;
      percentage.innerHTML = `Downloaded 100%`;
      progressBar.style.width = "100%";
      fileSizeBar.innerHTML = `${fileSizeMB} / ${fileSizeMB} MB`;
      a.click();
      isTaskRunning = false;
    }
  } else {
    let skips = 0;
    if (size % chunkSize === 0) {
      skips = size / chunkSize;
    } else {
      skips = Math.floor(size / chunkSize) + 1;
    }
    let heads = Array.from(Array(skips).keys());
    let promises = [];
    let progress = 0;
    heads.forEach((head) => {
      promises.push(
        fetch(`/api/download/na/${file.hash}/${head}`)
          .then((response) => {
            if (response.status === 403) {
              alert(`File access denied by owner!`);
              window.location.reload();
            } else if (response.status === 502) {
              alert(`Server refused to deliver chunk ${head}, try again!`);
              window.location.reload();
            } else {
              return response.blob();
            }
          })
          .then((blob) => {
            progress++;
            progressBar.style.width = `${(progress / skips) * 100}%`;
            percentage.innerHTML = `Downloaded ${(
              (progress / skips) *
              100
            ).toFixed(2)}%`;
            fileSizeBar.innerHTML = `${(
              (progress * chunkSize) /
              (1024 * 1024)
            ).toFixed(2)} / ${fileSizeMB} MB`;
            return blob;
          })
      );
    });
    const blobs = await Promise.all(promises);
    progressBar.style.width = "100%";
    percentage.innerHTML = `Downloaded 100%`;
    fileSizeBar.innerHTML = `${fileSizeMB} / ${fileSizeMB} MB`;
    let blob = new Blob(blobs, { type: file.mime });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    isTaskRunning = false;
  }
});

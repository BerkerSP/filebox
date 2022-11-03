let fileView = document.getElementById('file-view');
let progressBar = null;


window.onload = function() {
    let hash = window.location.href.split("/").pop();
    fetch(`/api/shared/metadata/${hash}`)
    .then(res => res.json())
    .then(data => {
        fileView.appendChild(newFileRow(data));
        progressBar = document.getElementById(`progress-${hash}`);
    })
}


function newFileRow(file) {
    let tr = document.createElement('tr');
    tr.id = file.hash;
    let tdName = document.createElement('td');
    let tdSize = document.createElement('td');
    let tdDate = document.createElement('td')
    let tdNameInnerDiv = document.createElement('div');
    tdNameInnerDiv.className = "name";
    let tdNameInnerDivProgress = document.createElement('div');
    tdNameInnerDivProgress.style.backgroundColor = "rgba(23, 131, 68, 0.323)";
    tdNameInnerDivProgress.className = "progress";
    tdNameInnerDivProgress.style.width = "0%";
    tdNameInnerDivProgress.id = `progress-${file.hash}`;
    let tdNameInnerI = document.createElement('i');
    tdNameInnerI.className = handleMimeIcon(file.mime);
    let tdNameInnerH3 = document.createElement('h3');
    tdNameInnerH3.innerText = file.name;
    tdNameInnerDiv.appendChild(tdNameInnerDivProgress);
    tdNameInnerDiv.appendChild(tdNameInnerI);
    tdNameInnerDiv.appendChild(tdNameInnerH3);
    tdName.appendChild(tdNameInnerDiv);
    let tdSizeInnerH3 = document.createElement('h3');
    tdSizeInnerH3.innerText = handleSizeUnit(file.size);
    tdSize.appendChild(tdSizeInnerH3);
    let tdDateInnerH3 = document.createElement('h3');
    let date = new Date(file.date);
    tdDateInnerH3.innerText = date.getDate()
        + "/" + (date.getMonth() + 1)
        + "/" + date.getFullYear()
        + " " + date.getHours()
        + ":" + date.getMinutes()
        + ":" + date.getSeconds();
    tdDate.appendChild(tdDateInnerH3);
    let tdDownload = document.createElement('td');
    let downloadButton = document.createElement('button');
    downloadButton.innerHTML = `<i class="fa-solid fa-download"></i>`;
    downloadButton.style.backgroundColor = "rgba(14, 116, 250, 0.658)";
    downloadButton.addEventListener('click', () => {
        downloadByChunk(file);
    });
    tdDownload.appendChild(downloadButton);
    tr.appendChild(tdName);
    tr.appendChild(tdSize);
    tr.appendChild(tdDate);
    tr.appendChild(tdDownload);
    return tr;
}


function handleMimeIcon(mime) {
    if (mime.startsWith("image")) {
        return "fa-solid fa-image";
    } else if (mime.startsWith("video")) {
        return "fa-solid fa-video";
    } else if (mime.startsWith("audio")) {
        return "fa-solid fa-headphones";
    } else if (mime.startsWith("text")) {
        return  "fa-solid fa-file-lines";
    } else if (mime.startsWith("application/pdf")) {
        return "fa-solid fa-file-pdf";
    } else if (mime.startsWith("application/zip")) {
        return "fa-solid fa-file-zipper";
    } else {
        return "fa-solid fa-file";
    }
}

function handleSizeUnit(size) {
    if (size < 1024) {
        return size + " B";
    } else if (size < 1024 * 1024) {
        return (size / 1024).toFixed(4) + " KB";
    } else if (size < 1024 * 1024 * 1024) {
        return (size / 1024 / 1024).toFixed(4) + " MB";
    } else {
        return (size / 1024 / 1024 / 1024).toFixed(4) + " GB";
    }
}

function showSnack(inner) {
    let x = document.getElementById("snackbar");
    x.className = "show";
    x.innerHTML = inner;
    setTimeout(() => {
        x.className = x.className.replace("show", "")
    }, 3000);
}


function downloadByChunk(file) {
    let size = file.size;
    let name = file.name;
    let extension = name.split('.').pop();
    const chunkSize = 1024 * 1024 * 4
    showSnack(`Downloading ${name}`);
    let hashedName = file.hash + "." + extension;
    if (size < chunkSize) {
        fetch(`/api/shared/chunk/0/${hashedName}`)
        .then(response => response.blob())
        .then(blob => {
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
        })
    } else {
        let skips = 0;
        if (size % chunkSize === 0) {
            skips = size / chunkSize;
        } else {
            skips = Math.floor(size / chunkSize) + 1;
        }
        let heads = Array.from(Array(skips).keys());
        console.log(heads);
        let promises = [];
        let progress = 0;
        heads.forEach((head) => {
            promises.push(
                fetch(`/api/shared/chunk/${head}/${hashedName}`)
                .then(response => {
                     progress++;
                     progressBar.style.width = (progress / skips * 100) + "%";
                     return response.blob();
                })
                .then(blob => {
                    return blob;
                })
            );
        });
        Promise.all(promises)
        .then(blobs => {
            let blob = new Blob(blobs, {type: file.mime});
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.click();
            progressBar.style.width = "100%";
            progress = 0;
            setTimeout(() => {
                progressBar.style.backgroundColor = "transparent";
                progressBar.style.width = "0%";
                progressBar.style.backgroundColor = "rgba(23, 131, 68, 0.323)";
                showSnack(`Downloaded! ${name}`);
            }, 1000);
        })
    }
}
Generate and display the htmlpreview link for the current branch.

Run these commands and output the result:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse --short HEAD)
echo "https://htmlpreview.github.io/?https://raw.githubusercontent.com/021-lab/searchmydata/${BRANCH}/list-manager.html?v=${COMMIT}"
```

Output only the URL, no extra text.

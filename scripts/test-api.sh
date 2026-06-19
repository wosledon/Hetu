#!/usr/bin/env bash
set -e

BASE="http://localhost:5000/api"

echo "=== Create notebook ==="
NOTEBOOK=$(curl -s -X POST "$BASE/notebooks" -H "Content-Type: application/json" -d '{"name":"Test Notebook"}')
echo "$NOTEBOOK"
NOTEBOOK_ID=$(echo "$NOTEBOOK" | grep -oP '"id":"[^"]+' | head -1 | cut -d'"' -f4)
echo "Notebook ID: $NOTEBOOK_ID"

TAG_NAME="test-tag-$(date +%s)"
echo "=== Create tag ($TAG_NAME) ==="
TAG=$(curl -s -X POST "$BASE/tags" -H "Content-Type: application/json" -d "{\"name\":\"$TAG_NAME\"}")
echo "$TAG"
TAG_ID=$(echo "$TAG" | grep -oP '"id":"[^"]+' | head -1 | cut -d'"' -f4)
echo "Tag ID: $TAG_ID"

echo "=== Create note ==="
NOTE=$(curl -s -X POST "$BASE/notes" -H "Content-Type: application/json" -d "{\"title\":\"Test Note\",\"content\":\"This is the content of the test note.\",\"notebookId\":\"$NOTEBOOK_ID\"}")
echo "$NOTE"
NOTE_ID=$(echo "$NOTE" | grep -oP '"id":"[^"]+' | head -1 | cut -d'"' -f4)
echo "Note ID: $NOTE_ID"

echo "=== Assign tag to note ==="
curl -s -X PUT "$BASE/tags/note/$NOTE_ID" -H "Content-Type: application/json" -d "{\"tagIds\":[\"$TAG_ID\"]}"; echo

echo "=== Search notes ==="
curl -s "$BASE/search/notes?keyword=content"; echo

echo "=== Delete note ==="
curl -s -X DELETE "$BASE/notes/$NOTE_ID"; echo

echo "=== List deleted notes ==="
curl -s "$BASE/notes?includeDeleted=true"; echo

echo "=== Restore note ==="
curl -s -X POST "$BASE/notes/$NOTE_ID/restore"; echo

echo "=== Settings ==="
curl -s "$BASE/settings"; echo

package workflows

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"strings"

	"github.com/dslipak/pdf"
)

const maxExtractedSourceBytes = 2 * 1024 * 1024

type SourceTextExtractor interface {
	Extract(data []byte, contentType string) (string, error)
}

type sourceTextExtractor struct{}

func NewSourceTextExtractor() SourceTextExtractor {
	return sourceTextExtractor{}
}

func (sourceTextExtractor) Extract(data []byte, contentType string) (string, error) {
	mediaType := normalizeMediaType(contentType)
	// Treat the PDF signature as authoritative when storage metadata is missing
	// or was incorrectly propagated as application/json. Never pass PDF bytes
	// through the text branch: that sends the binary document to distillation.
	if mediaType == "application/pdf" || bytes.HasPrefix(data, []byte("%PDF-")) {
		return extractPDFText(data)
	}
	switch {
	case strings.HasPrefix(mediaType, "text/"), mediaType == "application/json":
		return boundedText(bytes.NewReader(data))
	default:
		return "", fmt.Errorf("unsupported source content type %q", contentType)
	}
}

func normalizeMediaType(contentType string) string {
	contentType = strings.TrimSpace(strings.ToLower(contentType))
	if mediaType, _, err := mime.ParseMediaType(contentType); err == nil {
		return mediaType
	}
	return strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0])
}

func extractPDFText(data []byte) (string, error) {
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("invalid or encrypted PDF: %w", err)
	}
	plainText, err := reader.GetPlainText()
	if err != nil {
		return "", fmt.Errorf("extract PDF text: %w", err)
	}
	text, err := boundedText(plainText)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("PDF contains no extractable text; OCR is required")
	}
	return text, nil
}

func boundedText(reader io.Reader) (string, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxExtractedSourceBytes+1))
	if err != nil {
		return "", fmt.Errorf("read source text: %w", err)
	}
	if len(data) > maxExtractedSourceBytes {
		return "", fmt.Errorf("extracted source text exceeds %d bytes", maxExtractedSourceBytes)
	}
	return strings.TrimSpace(string(data)), nil
}

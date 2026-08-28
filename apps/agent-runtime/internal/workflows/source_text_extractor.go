package workflows

import (
	"bytes"
	"fmt"
	"io"
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
	switch {
	case strings.HasPrefix(contentType, "text/"), contentType == "application/json":
		return boundedText(bytes.NewReader(data))
	case contentType == "application/pdf":
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
	default:
		return "", fmt.Errorf("unsupported source content type %q", contentType)
	}
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

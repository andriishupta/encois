package memory

import (
	"regexp"
	"strings"

	contracts "github.com/andriishupta/encois/packages/contracts"
)

const RedactionVersion = "regex-v1"

var sensitivePatterns = []struct {
	pattern     *regexp.Regexp
	replacement string
}{
	{regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`), "[REDACTED_EMAIL]"},
	{regexp.MustCompile(`(?:\+[0-9][0-9 ()-]{8,}[0-9]|\([0-9]{3}\)[ -]?[0-9]{3}[ -]?[0-9]{4}|[0-9]{3}[ -][0-9]{3}[ -][0-9]{4})`), "[REDACTED_PHONE]"},
	{regexp.MustCompile(`(?i)\b(?:bearer\s+|token\s+|api[_-]?key\s*[:=]\s*)[A-Za-z0-9._~+/=-]{12,}`), "[REDACTED_SECRET]"},
	{regexp.MustCompile(`\b(?:ghp|github_pat|sk|xox[baprs])_[A-Za-z0-9_-]{12,}\b`), "[REDACTED_SECRET]"},
}

func RedactSensitiveText(value string) (string, bool) {
	redacted := value
	for _, candidate := range sensitivePatterns {
		redacted = candidate.pattern.ReplaceAllString(redacted, candidate.replacement)
	}
	return redacted, redacted != value
}

// SanitizeRequest is a deterministic pre-write boundary. It is deliberately
// conservative: regexes cover obvious PII/secrets now; provider-specific and
// semantic detection remains a later policy/model adapter.
func SanitizeRequest(request Request) Request {
	if request.Distillation != nil {
		distillation := *request.Distillation
		redacted, changed := RedactSensitiveText(distillation.Summary)
		distillation.Summary = strings.TrimSpace(redacted)
		distillation.RedactionVersion = RedactionVersion
		if changed {
			distillation.RedactionStatus = contracts.RedactionApplied
		} else {
			distillation.RedactionStatus = contracts.RedactionNoMatch
		}
		request.Distillation = &distillation
	}
	if request.ReplacementSummary != "" {
		request.ReplacementSummary, _ = RedactSensitiveText(request.ReplacementSummary)
		request.ReplacementSummary = strings.TrimSpace(request.ReplacementSummary)
	}
	return request
}

func SanitizeResult(result Result) Result {
	sanitized := result
	sanitized.Memories = make([]Record, len(result.Memories))
	for index, record := range result.Memories {
		sanitized.Memories[index] = record
		sanitized.Memories[index].Summary, _ = RedactSensitiveText(record.Summary)
	}
	return sanitized
}

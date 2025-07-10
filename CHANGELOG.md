# Tribeunal MCP Server Changelog

## [1.1.0] - 2025-01-10

### Added
- Trial URLs are now included in all API responses
- Trial creation response prominently displays the shareable URL
- Added `url` and `slug` fields to Trial DTO

### Changed
- MCP server now displays UUID instead of numeric ID in responses
- Improved trial creation success message to include the full URL
- Updated documentation to explain URL structure

### Fixed
- Fixed incorrect URL pattern - trials use `/cases/{uuid}/{slug}` not `/trial/{id}`
- MCP server now returns proper shareable URLs for all trials

### Technical Details
- Updated `src/Dto/Trial.php` to include `url` and `slug` fields
- Modified `src/Dto/Factory.php` to generate URLs using Symfony router
- Enhanced `src/Controller/Api/TrialController.php` to return slug and URL
- Improved MCP server response formatting in `mcp-server/src/server.ts`

### Migration Notes
No breaking changes. The numeric `id` field is still returned for backwards compatibility, but clients should use `uuid` for all operations.
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hetu.Infrastructure.PostgresMigrations.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddChatMessageToolCalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ConnectionType",
                table: "WorkProjects",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Local");

            migrationBuilder.AddColumn<string>(
                name: "SshAuthType",
                table: "WorkProjects",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Key");

            migrationBuilder.AddColumn<string>(
                name: "SshHost",
                table: "WorkProjects",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SshKeyPath",
                table: "WorkProjects",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SshPasswordProtected",
                table: "WorkProjects",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SshPort",
                table: "WorkProjects",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "SshUser",
                table: "WorkProjects",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ToolCallsJson",
                table: "ChatMessages",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ConnectionType",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshAuthType",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshHost",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshKeyPath",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshPasswordProtected",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshPort",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "SshUser",
                table: "WorkProjects");

            migrationBuilder.DropColumn(
                name: "ToolCallsJson",
                table: "ChatMessages");
        }
    }
}

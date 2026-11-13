name: Pull request

body:
  - type: markdown
    attributes:
      value: |
        Thanks for the contribution. Please describe the change and make sure
        `npm run typecheck`, `npm test` and `npm run build` pass.

  - type: textarea
    id: what
    attributes:
      label: What does this change?
      description: What is different now, and why?
    validations:
      required: true

  - type: textarea
    id: scope
    attributes:
      label: Which data does this touch?
      description: |
        If the change reads or writes user data, say which scope it uses.
        A change that breaks the per user scoping is a security bug.
    validations:
      required: false

  - type: checkboxes
    id: checks
    attributes:
      label: Checks
      options:
        - label: npm run typecheck passes
          required: true
        - label: npm test passes
          required: true
        - label: npm run build passes
          required: true
        - label: I did not add a secret to the repository
          required: true

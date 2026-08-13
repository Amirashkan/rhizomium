import { ACCENT, TEXT } from '../../core/theme.js';

export class BooleanInputHandler {
  constructor(undoManager) {
    this.undoManager = undoManager;
  }

  create(param, node, container, label, valueManager, onUpdate) {
    const value = valueManager.getValue(node, param.name) ?? param.default ?? false;
    
    const checkboxContainer = document.createElement('div');
    checkboxContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    `;
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = value;
    checkbox.className = 'param-input';
    checkbox.setAttribute('data-param', param.name);
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: ${ACCENT.base};
    `;
    
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      
      const oldValue = valueManager.getValue(node, param.name);
      const newValue = e.target.checked;
      
      if (this.undoManager) {
        this.undoManager.recordParameterChange(
          node,
          param.name,
          oldValue,
          newValue,
          `Toggle ${param.displayName || param.name}`
        );
      }
      
      valueManager.setValue(node, param.name, newValue);
      onUpdate(`Toggle ${param.displayName || param.name}`);
    });
    
    const checkboxLabel = document.createElement('label');
    checkboxLabel.textContent = value ? 'Enabled' : 'Disabled';
    checkboxLabel.style.cssText = `
      font-size: 11.5px;
      color: ${TEXT.secondary};
      cursor: pointer;
    `;
    
    checkbox.addEventListener('change', () => {
      checkboxLabel.textContent = checkbox.checked ? 'Enabled' : 'Disabled';
    });
    
    checkboxLabel.addEventListener('click', () => {
      checkbox.click();
    });
    
    checkboxContainer.appendChild(checkbox);
    checkboxContainer.appendChild(checkboxLabel);
    container.appendChild(checkboxContainer);
  }
}